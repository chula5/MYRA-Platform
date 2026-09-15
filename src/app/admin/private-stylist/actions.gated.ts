'use server'

// The browser-callable surface of ./actions.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./actions directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './actions'

export async function addComposedLookItem(...args: Parameters<typeof impl.addComposedLookItem>): Promise<Awaited<ReturnType<typeof impl.addComposedLookItem>>> {
  await assertAdmin()
  return impl.addComposedLookItem(...args)
}

export async function addKnownEvent(...args: Parameters<typeof impl.addKnownEvent>): Promise<Awaited<ReturnType<typeof impl.addKnownEvent>>> {
  await assertAdmin()
  return impl.addKnownEvent(...args)
}

export async function addMemberBrand(...args: Parameters<typeof impl.addMemberBrand>): Promise<Awaited<ReturnType<typeof impl.addMemberBrand>>> {
  await assertAdmin()
  return impl.addMemberBrand(...args)
}

export async function addWardrobeItem(...args: Parameters<typeof impl.addWardrobeItem>): Promise<Awaited<ReturnType<typeof impl.addWardrobeItem>>> {
  await assertAdmin()
  return impl.addWardrobeItem(...args)
}

export async function approveComposedLook(...args: Parameters<typeof impl.approveComposedLook>): Promise<Awaited<ReturnType<typeof impl.approveComposedLook>>> {
  await assertAdmin()
  return impl.approveComposedLook(...args)
}

export async function askPreviewAlternates(...args: Parameters<typeof impl.askPreviewAlternates>): Promise<Awaited<ReturnType<typeof impl.askPreviewAlternates>>> {
  await assertAdmin()
  return impl.askPreviewAlternates(...args)
}

export async function assignMemberPersona(...args: Parameters<typeof impl.assignMemberPersona>): Promise<Awaited<ReturnType<typeof impl.assignMemberPersona>>> {
  await assertAdmin()
  return impl.assignMemberPersona(...args)
}

export async function clearDeliveryLooks(...args: Parameters<typeof impl.clearDeliveryLooks>): Promise<Awaited<ReturnType<typeof impl.clearDeliveryLooks>>> {
  await assertAdmin()
  return impl.clearDeliveryLooks(...args)
}

export async function clearLook(...args: Parameters<typeof impl.clearLook>): Promise<Awaited<ReturnType<typeof impl.clearLook>>> {
  await assertAdmin()
  return impl.clearLook(...args)
}

export async function composeDeliveryLooks(...args: Parameters<typeof impl.composeDeliveryLooks>): Promise<Awaited<ReturnType<typeof impl.composeDeliveryLooks>>> {
  await assertAdmin()
  return impl.composeDeliveryLooks(...args)
}

export async function composeLookVariants(...args: Parameters<typeof impl.composeLookVariants>): Promise<Awaited<ReturnType<typeof impl.composeLookVariants>>> {
  await assertAdmin()
  return impl.composeLookVariants(...args)
}

export async function createCalibrationSet(...args: Parameters<typeof impl.createCalibrationSet>): Promise<Awaited<ReturnType<typeof impl.createCalibrationSet>>> {
  await assertAdmin()
  return impl.createCalibrationSet(...args)
}

export async function createDelivery(...args: Parameters<typeof impl.createDelivery>): Promise<Awaited<ReturnType<typeof impl.createDelivery>>> {
  await assertAdmin()
  return impl.createDelivery(...args)
}

export async function createMember(...args: Parameters<typeof impl.createMember>): Promise<Awaited<ReturnType<typeof impl.createMember>>> {
  await assertAdmin()
  return impl.createMember(...args)
}

export async function deleteDelivery(...args: Parameters<typeof impl.deleteDelivery>): Promise<Awaited<ReturnType<typeof impl.deleteDelivery>>> {
  await assertAdmin()
  return impl.deleteDelivery(...args)
}

export async function deleteDeliveryAndMemory(...args: Parameters<typeof impl.deleteDeliveryAndMemory>): Promise<Awaited<ReturnType<typeof impl.deleteDeliveryAndMemory>>> {
  await assertAdmin()
  return impl.deleteDeliveryAndMemory(...args)
}

export async function deleteLook(...args: Parameters<typeof impl.deleteLook>): Promise<Awaited<ReturnType<typeof impl.deleteLook>>> {
  await assertAdmin()
  return impl.deleteLook(...args)
}

export async function deleteLookShoot(...args: Parameters<typeof impl.deleteLookShoot>): Promise<Awaited<ReturnType<typeof impl.deleteLookShoot>>> {
  await assertAdmin()
  return impl.deleteLookShoot(...args)
}

export async function deleteMember(...args: Parameters<typeof impl.deleteMember>): Promise<Awaited<ReturnType<typeof impl.deleteMember>>> {
  await assertAdmin()
  return impl.deleteMember(...args)
}

export async function keepAskPreview(...args: Parameters<typeof impl.keepAskPreview>): Promise<Awaited<ReturnType<typeof impl.keepAskPreview>>> {
  await assertAdmin()
  return impl.keepAskPreview(...args)
}

export async function loadMemberBrandMap(...args: Parameters<typeof impl.loadMemberBrandMap>): Promise<Awaited<ReturnType<typeof impl.loadMemberBrandMap>>> {
  await assertAdmin()
  return impl.loadMemberBrandMap(...args)
}

export async function loadMemberTrust(...args: Parameters<typeof impl.loadMemberTrust>): Promise<Awaited<ReturnType<typeof impl.loadMemberTrust>>> {
  await assertAdmin()
  return impl.loadMemberTrust(...args)
}

export async function logActivity(...args: Parameters<typeof impl.logActivity>): Promise<Awaited<ReturnType<typeof impl.logActivity>>> {
  await assertAdmin()
  return impl.logActivity(...args)
}

export async function lookAddOptions(...args: Parameters<typeof impl.lookAddOptions>): Promise<Awaited<ReturnType<typeof impl.lookAddOptions>>> {
  await assertAdmin()
  return impl.lookAddOptions(...args)
}

export async function lookAlternates(...args: Parameters<typeof impl.lookAlternates>): Promise<Awaited<ReturnType<typeof impl.lookAlternates>>> {
  await assertAdmin()
  return impl.lookAlternates(...args)
}

export async function markStockChecked(...args: Parameters<typeof impl.markStockChecked>): Promise<Awaited<ReturnType<typeof impl.markStockChecked>>> {
  await assertAdmin()
  return impl.markStockChecked(...args)
}

export async function recomputeWeights(...args: Parameters<typeof impl.recomputeWeights>): Promise<Awaited<ReturnType<typeof impl.recomputeWeights>>> {
  await assertAdmin()
  return impl.recomputeWeights(...args)
}

export async function recordMemberLookFeedback(...args: Parameters<typeof impl.recordMemberLookFeedback>): Promise<Awaited<ReturnType<typeof impl.recordMemberLookFeedback>>> {
  await assertAdmin()
  return impl.recordMemberLookFeedback(...args)
}

export async function recordResponse(...args: Parameters<typeof impl.recordResponse>): Promise<Awaited<ReturnType<typeof impl.recordResponse>>> {
  await assertAdmin()
  return impl.recordResponse(...args)
}

export async function removeComposedLookItem(...args: Parameters<typeof impl.removeComposedLookItem>): Promise<Awaited<ReturnType<typeof impl.removeComposedLookItem>>> {
  await assertAdmin()
  return impl.removeComposedLookItem(...args)
}

export async function removeKnownEvent(...args: Parameters<typeof impl.removeKnownEvent>): Promise<Awaited<ReturnType<typeof impl.removeKnownEvent>>> {
  await assertAdmin()
  return impl.removeKnownEvent(...args)
}

export async function removeMemberBrand(...args: Parameters<typeof impl.removeMemberBrand>): Promise<Awaited<ReturnType<typeof impl.removeMemberBrand>>> {
  await assertAdmin()
  return impl.removeMemberBrand(...args)
}

export async function removeWardrobeItem(...args: Parameters<typeof impl.removeWardrobeItem>): Promise<Awaited<ReturnType<typeof impl.removeWardrobeItem>>> {
  await assertAdmin()
  return impl.removeWardrobeItem(...args)
}

export async function reopenDelivery(...args: Parameters<typeof impl.reopenDelivery>): Promise<Awaited<ReturnType<typeof impl.reopenDelivery>>> {
  await assertAdmin()
  return impl.reopenDelivery(...args)
}

export async function restoreLookShoot(...args: Parameters<typeof impl.restoreLookShoot>): Promise<Awaited<ReturnType<typeof impl.restoreLookShoot>>> {
  await assertAdmin()
  return impl.restoreLookShoot(...args)
}

export async function restoreMemberBrand(...args: Parameters<typeof impl.restoreMemberBrand>): Promise<Awaited<ReturnType<typeof impl.restoreMemberBrand>>> {
  await assertAdmin()
  return impl.restoreMemberBrand(...args)
}

export async function saveLook(...args: Parameters<typeof impl.saveLook>): Promise<Awaited<ReturnType<typeof impl.saveLook>>> {
  await assertAdmin()
  return impl.saveLook(...args)
}

export async function seedSyntheticPersonas(...args: Parameters<typeof impl.seedSyntheticPersonas>): Promise<Awaited<ReturnType<typeof impl.seedSyntheticPersonas>>> {
  await assertAdmin()
  return impl.seedSyntheticPersonas(...args)
}

export async function sendDelivery(...args: Parameters<typeof impl.sendDelivery>): Promise<Awaited<ReturnType<typeof impl.sendDelivery>>> {
  await assertAdmin()
  return impl.sendDelivery(...args)
}

export async function setMemberBrands(...args: Parameters<typeof impl.setMemberBrands>): Promise<Awaited<ReturnType<typeof impl.setMemberBrands>>> {
  await assertAdmin()
  return impl.setMemberBrands(...args)
}

export async function skipComposedLook(...args: Parameters<typeof impl.skipComposedLook>): Promise<Awaited<ReturnType<typeof impl.skipComposedLook>>> {
  await assertAdmin()
  return impl.skipComposedLook(...args)
}

export async function swapComposedLookItem(...args: Parameters<typeof impl.swapComposedLookItem>): Promise<Awaited<ReturnType<typeof impl.swapComposedLookItem>>> {
  await assertAdmin()
  return impl.swapComposedLookItem(...args)
}

export async function updateDelivery(...args: Parameters<typeof impl.updateDelivery>): Promise<Awaited<ReturnType<typeof impl.updateDelivery>>> {
  await assertAdmin()
  return impl.updateDelivery(...args)
}

export async function updateMember(...args: Parameters<typeof impl.updateMember>): Promise<Awaited<ReturnType<typeof impl.updateMember>>> {
  await assertAdmin()
  return impl.updateMember(...args)
}
