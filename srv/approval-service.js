import cds from '@sap/cds'
import { CHANGE_STATUS, suggestParameters, supplyPlanningKey, supplyPlanningPayload, parametersChangedSince } from './lib/planning.js'
import { patchSupplyPlanning, describeError } from './lib/s4.js'
import { writeMode, fourEyes } from './lib/config.js'

const LOG = cds.log('approval')

export class ApprovalService extends cds.ApplicationService {
  init () {
    const { Changes } = this.entities
    const db = cds.entities('brightline.planning')

    const load = async (req) => {
      const { ID } = req.params[0]
      const c = await SELECT.one.from(db.ParameterChanges).where({ ID })
      if (!c) req.reject(404, 'Change not found.')
      return c
    }

    const decide = async (req, newStatus, eventType) => {
      const c = await load(req)
      if (c.status_code !== CHANGE_STATUS.SUBMITTED) {
        return req.reject(409, `Change ${c.changeNo} is no longer waiting for a decision.`)
      }
      if (fourEyes() && c.createdBy === req.user.id) {
        return req.reject(403, 'Four-eyes principle: you cannot decide on a change you proposed yourself.')
      }
      if (newStatus === CHANGE_STATUS.APPROVED) {
        const m = await SELECT.one.from(db.Materials).where({ material: c.material, plant: c.plant })
        if (m && parametersChangedSince(m, c)) {
          return req.reject(409, `The parameters of ${c.material} have changed since change ${c.changeNo} was proposed. Reject it so that the planner can propose again.`)
        }
      }
      const note = req.data.note?.trim() || null
      await UPDATE(db.ParameterChanges, { ID: c.ID }).set({
        status_code: newStatus,
        decisionNote: note,
        decidedBy: req.user.id,
        decidedAt: new Date().toISOString()
      })
      await INSERT.into(db.ChangeEvents).entries({ change_ID: c.ID, eventType, note })
      req.notify(newStatus === CHANGE_STATUS.APPROVED
        ? `Change ${c.changeNo} approved. Next step: Update in S/4HANA.`
        : `Change ${c.changeNo} rejected.`)
      return SELECT.one.from(Changes).where({ ID: c.ID })
    }

    this.on('approveChange', Changes, req => decide(req, CHANGE_STATUS.APPROVED, 'APPROVED'))

    this.on('rejectChange', Changes, req => {
      if (!req.data.note?.trim()) return req.reject(400, 'Enter a reason for the rejection.', 'note')
      return decide(req, CHANGE_STATUS.REJECTED, 'REJECTED')
    })

    this.on('updateS4', Changes, async req => {
      const c = await load(req)
      if (c.status_code !== CHANGE_STATUS.APPROVED) {
        return req.reject(409, `Change ${c.changeNo} must be approved before it can be written to S/4HANA.`)
      }
      const target = supplyPlanningKey(c.material, c.plant)
      const payload = supplyPlanningPayload(c)
      let mode
      let note
      if (writeMode() === 'live') {
        try {
          await patchSupplyPlanning(target, payload)
          mode = 'S4'
          note = `MRP data of ${c.material} in plant ${c.plant} updated in SAP S/4HANA.`
        } catch (e) {
          return req.reject(502, `Updating the MRP data in S/4HANA failed: ${describeError(e).message}`)
        }
      } else {
        mode = 'SIMULATED'
        note = `Simulated update of the MRP data of ${c.material} in plant ${c.plant} (the S/4HANA sandbox is read-only).`
      }

      const now = new Date().toISOString()
      await UPDATE(db.ParameterChanges, { ID: c.ID }).set({
        status_code: CHANGE_STATUS.UPDATED,
        s4Mode: mode,
        s4Target: target,
        s4UpdatedAt: now,
        s4Payload: JSON.stringify(payload, null, 2)
      })

      // the cockpit works with the new parameters from now on
      const m = await SELECT.one.from(db.Materials).where({ material: c.material, plant: c.plant })
      if (m) {
        const applied = {
          mrpType: c.newMrpType,
          reorderPoint: c.newReorderPoint,
          safetyStock: c.newSafetyStock,
          maxStock: c.newMaxStock,
          leadTimeDays: c.newLeadTimeDays ?? m.leadTimeDays,
          parameterSource: 'APPROVED',
          parameterChangedBy: req.user.id,
          parameterChangedAt: now,
          parameterChangeNo: c.changeNo
        }
        const s = suggestParameters({ ...m, ...applied })
        Object.assign(applied, {
          suggestedReorderPoint: s?.reorderPoint ?? null,
          suggestedSafetyStock: s?.safetyStock ?? null,
          suggestedMaxStock: s?.maxStock ?? null
        })
        await UPDATE(db.Materials, { material: c.material, plant: c.plant }).set(applied)
      }
      await INSERT.into(db.ChangeEvents).entries({ change_ID: c.ID, eventType: 'S4_UPDATED', note })
      LOG.info(`${c.changeNo}: ${note}`)
      req.notify(note)
      return SELECT.one.from(Changes).where({ ID: c.ID })
    })

    return super.init()
  }
}
