import { describe, expect, it } from 'vitest';

import { evaluateMdmEligibility } from './eligibility';
import { validateMdmCommandRequest } from './commandPolicy';

const eligibleDevice = {
  tenantId: 'tenant-001',
  deviceId: 'POS-001',
  platform: 'android',
  appVersion: '1.0.23',
  appFlavor: 'web-production',
  nativeGeneration: null,
  ownershipType: 'company_financed',
  enrollmentMode: 'android_enterprise_device_owner',
  isDeviceOwner: true,
  capabilities: [
    'mdm_core',
    'remote_lock',
    'location',
    'remote_support',
    'app_install',
    'app_uninstall',
    'policy_sync',
  ],
};

describe('Android 1.0.23 Web Production MDM eligibility', () => {
  it('allows full MDM for enrolled company financed Android 1.0.23 Web Production devices', () => {
    const decision = evaluateMdmEligibility(eligibleDevice);

    expect(decision.mode).toBe('full_mdm');
    expect(decision.isEligible).toBe(true);
    expect(decision.allowedCommands).toContain('lock_device');
    expect(decision.allowedCommands).toContain('uninstall_app');
    expect(decision.allowedCommands).toContain('start_remote_support');
  });

  it('keeps FF0001-style unmanaged Android 1.0.21 devices in diagnostics only mode', () => {
    const decision = evaluateMdmEligibility({
      tenantId: 'tenant-001',
      deviceId: 'FF0001-POS-01',
      platform: 'android',
      appVersion: '1.0.21',
      appFlavor: 'web-production',
      ownershipType: 'company_financed',
      enrollmentMode: 'none',
      isDeviceOwner: false,
      capabilities: ['mdm_core'],
    });

    expect(decision.mode).toBe('diagnostics_only');
    expect(decision.allowedCommands).toEqual(['diagnostics_ping']);
    expect(decision.reasons).toContain('android_app_version_must_be_exactly_1_0_23');
    expect(decision.reasons).toContain('android_device_owner_required');
  });

  it('excludes Android 1.0.12 LTS from full MDM', () => {
    const decision = evaluateMdmEligibility({
      ...eligibleDevice,
      appVersion: '1.0.12',
    });

    expect(decision.mode).toBe('diagnostics_only');
    expect(decision.reasons).toContain('android_lts_1_0_12_is_excluded');
  });

  it('excludes Native 2.0 from full MDM', () => {
    const decision = evaluateMdmEligibility({
      ...eligibleDevice,
      nativeGeneration: '2.0',
    });

    expect(decision.mode).toBe('diagnostics_only');
    expect(decision.reasons).toContain('native_2_0_excluded_from_full_mdm');
  });

  it('excludes BYOD and customer-owned devices from full MDM', () => {
    const byod = evaluateMdmEligibility({ ...eligibleDevice, ownershipType: 'byod' });
    const customerOwned = evaluateMdmEligibility({ ...eligibleDevice, ownershipType: 'customer_owned' });

    expect(byod.mode).toBe('diagnostics_only');
    expect(customerOwned.mode).toBe('diagnostics_only');
    expect(byod.reasons).toContain('device_must_be_company_owned_or_company_financed');
    expect(customerOwned.reasons).toContain('device_must_be_company_owned_or_company_financed');
  });
});

describe('MDM command policy validation', () => {
  it('accepts lock command only when a sufficient reason and authorized role are provided', () => {
    const result = validateMdmCommandRequest(
      {
        tenantId: 'tenant-001',
        deviceId: 'POS-001',
        commandType: 'lock_device',
        requestedBy: 'owner-001',
        requestedByRole: 'owner',
        reason: 'Installment payment overdue and approved by owner',
      },
      eligibleDevice,
    );

    expect(result.accepted).toBe(true);
    expect(result.status).toBe('accepted_for_queue');
    expect(result.auditEvent.decision).toBe('accepted');
  });

  it('rejects sensitive MDM commands without a clear reason', () => {
    const result = validateMdmCommandRequest(
      {
        tenantId: 'tenant-001',
        deviceId: 'POS-001',
        commandType: 'lock_device',
        requestedByRole: 'owner',
        reason: 'lock',
      },
      eligibleDevice,
    );

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('reason_required_for_sensitive_mdm_command');
  });

  it('rejects silent remote screen access', () => {
    const result = validateMdmCommandRequest(
      {
        tenantId: 'tenant-001',
        deviceId: 'POS-001',
        commandType: 'start_remote_support',
        requestedByRole: 'mdm_admin',
        reason: 'Troubleshooting active store support case',
        payload: {
          sessionMode: 'silent',
          ttlMinutes: 30,
        },
      },
      eligibleDevice,
    );

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('remote_support_requires_attended_or_company_kiosk_mode');
    expect(result.reasons).toContain('silent_remote_screen_access_denied');
  });

  it('rejects uninstall commands on non-eligible devices', () => {
    const result = validateMdmCommandRequest(
      {
        tenantId: 'tenant-001',
        deviceId: 'FF0001-POS-01',
        commandType: 'uninstall_app',
        requestedByRole: 'owner',
        reason: 'Recover managed package after contract cancellation',
        payload: {
          packageName: 'com.example.unmanaged',
        },
      },
      {
        tenantId: 'tenant-001',
        deviceId: 'FF0001-POS-01',
        platform: 'android',
        appVersion: '1.0.21',
        appFlavor: 'web-production',
        ownershipType: 'company_financed',
        enrollmentMode: 'none',
        isDeviceOwner: false,
        capabilities: ['mdm_core'],
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('command_not_allowed_by_device_eligibility');
  });

  it('blocks uninstalling the CpIPOS MDM agent package directly', () => {
    const result = validateMdmCommandRequest(
      {
        tenantId: 'tenant-001',
        deviceId: 'POS-001',
        commandType: 'uninstall_app',
        requestedByRole: 'owner',
        reason: 'Attempt to remove protected core agent package',
        payload: {
          packageName: 'com.cpipos.mdm',
        },
      },
      eligibleDevice,
    );

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('core_agent_uninstall_blocked_use_revoke_access_policy');
  });
});
