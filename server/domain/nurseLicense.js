function licenseError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function validateNurseLicenseUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Object.hasOwn(payload, 'prcLicenseNumber') || typeof payload.prcLicenseNumber !== 'string') {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'A PRC license number string is required; leave it blank only to clear the record.' };
  }
  if (payload.verificationConfirmed !== undefined && typeof payload.verificationConfirmed !== 'boolean') {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'License verification confirmation must be true or false.' };
  }
  if (payload.prcLicenseNumber.length > 80) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'PRC license numbers must be 80 characters or fewer.' };
  }
  const licenseNumber = payload.prcLicenseNumber.trim();
  if (licenseNumber.length > 80) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'PRC license numbers must be 80 characters or fewer.' };
  }
  if (licenseNumber && payload.verificationConfirmed !== true) {
    return { valid: false, code: 'VERIFICATION_CONFIRMATION_REQUIRED', message: 'Confirm that the license was independently verified before recording it.' };
  }
  return { valid: true, licenseNumber, verified: Boolean(licenseNumber) };
}

export async function recordNurseLicenseVerification(client, userId, { licenseNumber, verified }, verifierId) {
  const locked = await client.query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE', [userId]);
  if (!locked.rowCount) throw licenseError(404, 'NOT_FOUND', 'User not found.');
  if (locked.rows[0].role !== 'school_nurse') {
    throw licenseError(409, 'NURSE_ACCOUNT_REQUIRED', 'A PRC license can only be recorded for a school nurse account.');
  }

  const result = await client.query(
    `UPDATE users
     SET prc_license_number=$1,
         prc_license_verified_at=CASE WHEN $4 THEN NOW() ELSE NULL END,
         prc_license_verified_by=CASE WHEN $4 THEN $2::uuid ELSE NULL END,
         updated_at=NOW()
     WHERE id=$3 AND role='school_nurse'
     RETURNING id,role,status,prc_license_verified_at IS NOT NULL AND prc_license_verified_by IS NOT NULL AS prc_license_verified`,
    [licenseNumber, verified ? verifierId : null, userId, verified],
  );
  if (!result.rowCount) throw licenseError(409, 'NURSE_ACCOUNT_REQUIRED', 'A PRC license can only be recorded for a school nurse account.');
  return { id: result.rows[0].id, role: result.rows[0].role, status: result.rows[0].status, verified: result.rows[0].prc_license_verified };
}
