const activatableRoles = new Set(['guardian', 'school_nurse', 'system_administrator']);

function accountError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function invalidInvitation() {
  return accountError(400, 'INVALID_INVITATION', 'The invitation is invalid, expired, or no longer active.');
}

export async function activateInvitedAccount(client, { tokenHash, username, passwordHash }) {
  // This first read is deliberately unlocked. Both activation and status changes lock
  // the user row before invitation rows, avoiding a user/invitation lock inversion.
  const candidateResult = await client.query(
    `SELECT id,email,role FROM invitations
     WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>NOW()`,
    [tokenHash],
  );
  const candidate = candidateResult.rows[0];
  if (!candidate) throw invalidInvitation();
  if (candidate.role === 'student') {
    throw accountError(410, 'STUDENT_INVITATIONS_REMOVED', 'Students do not activate accounts. A parent or guardian can sign in after receiving a guardian invitation.');
  }
  if (!activatableRoles.has(candidate.role)) throw invalidInvitation();

  const accountResult = await client.query(
    'SELECT * FROM users WHERE LOWER(email)=LOWER($1) FOR UPDATE',
    [candidate.email],
  );
  const account = accountResult.rows[0];
  if (!account || account.role !== candidate.role || account.status !== 'invited') throw invalidInvitation();

  if (account.role === 'guardian') {
    const linkedStudent = await client.query(
      `SELECT 1 FROM guardian_patient_links l JOIN patients p ON p.id=l.patient_id
       WHERE l.guardian_user_id=$1 AND p.patient_type='student' LIMIT 1`,
      [account.id],
    );
    if (!linkedStudent.rowCount) {
      throw accountError(409, 'GUARDIAN_LINK_REQUIRED', 'A guardian account must be linked to a student before activation.');
    }
  }

  // Revalidate and lock the invitation only after taking the account lock. A status
  // change waits on the same account row, then expires every unused invitation.
  const lockedInvitationResult = await client.query(
    `SELECT id,email,role FROM invitations
     WHERE id=$1 AND token_hash=$2 AND accepted_at IS NULL AND expires_at>NOW()
     FOR UPDATE`,
    [candidate.id, tokenHash],
  );
  const invitation = lockedInvitationResult.rows[0];
  if (!invitation || invitation.email.toLowerCase() !== account.email.toLowerCase() || invitation.role !== account.role) {
    throw invalidInvitation();
  }

  const activated = await client.query(
    `UPDATE users SET username=$1,password_hash=$2,status='active',updated_at=NOW()
     WHERE id=$3 AND status='invited' AND role=$4 RETURNING id`,
    [username, passwordHash, account.id, invitation.role],
  );
  if (!activated.rowCount) throw invalidInvitation();

  const consumed = await client.query(
    `UPDATE invitations SET accepted_at=NOW()
     WHERE id=$1 AND accepted_at IS NULL AND expires_at>NOW() RETURNING id`,
    [invitation.id],
  );
  if (!consumed.rowCount) throw invalidInvitation();
  return { id: account.id, role: account.role };
}

export async function changeAccountStatus(client, { userId, status, actorId }) {
  if (!['active', 'suspended', 'deactivated'].includes(status)) {
    throw accountError(400, 'INVALID_STATUS', 'Invalid account status.');
  }
  if (userId === actorId && status !== 'active') {
    throw accountError(400, 'SELF_DEACTIVATION', 'You cannot deactivate your own account.');
  }

  const currentResult = await client.query(
    'SELECT id,email,role,status FROM users WHERE id=$1 FOR UPDATE',
    [userId],
  );
  const current = currentResult.rows[0];
  if (!current) throw accountError(404, 'NOT_FOUND', 'User not found.');
  if (current.role === 'student' && status === 'active') {
    throw accountError(409, 'STUDENT_LOGIN_REMOVED', 'Student accounts cannot be reactivated. Invite a guardian account instead.');
  }
  if (current.role === 'guardian' && status === 'active') {
    const linkedStudent = await client.query(
      `SELECT 1 FROM guardian_patient_links l JOIN patients p ON p.id=l.patient_id
       WHERE l.guardian_user_id=$1 AND p.patient_type='student' LIMIT 1`,
      [userId],
    );
    if (!linkedStudent.rowCount) {
      throw accountError(409, 'GUARDIAN_LINK_REQUIRED', 'Link this guardian account to a student before restoring access.');
    }
  }
  if (current.status === 'invited' && status === 'active') {
    throw accountError(409, 'ACTIVATION_REQUIRED', 'Invited users must activate their account from the secure email link.');
  }

  const updated = await client.query(
    'UPDATE users SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',
    [status, userId],
  );
  if (!updated.rowCount) throw accountError(404, 'NOT_FOUND', 'User not found.');

  if (status !== 'active') {
    await client.query(
      `UPDATE invitations SET expires_at=LEAST(expires_at,NOW())
       WHERE LOWER(email)=LOWER($1) AND accepted_at IS NULL`,
      [current.email],
    );
    await client.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  }
  return updated.rows[0];
}

export async function renewPendingInvitation(client, { userId, invitationId, tokenHash, invitedBy }) {
  const accountResult = await client.query(
    'SELECT id,username,email,name,role,status FROM users WHERE id=$1 FOR UPDATE',
    [userId],
  );
  const account = accountResult.rows[0];
  if (!account) throw accountError(404, 'NOT_FOUND', 'User not found.');

  let hasAcceptedInvitation = false;
  if (account.status === 'deactivated' && account.username === `invited-${String(account.id).slice(0, 8)}`) {
    const acceptedInvitation = await client.query(
      'SELECT 1 FROM invitations WHERE LOWER(email)=LOWER($1) AND accepted_at IS NOT NULL LIMIT 1',
      [account.email],
    );
    hasAcceptedInvitation = Boolean(acceptedInvitation.rowCount);
  }
  const isUnactivatedCanceledAccount = account.status === 'deactivated'
    && account.username === `invited-${String(account.id).slice(0, 8)}`
    && !hasAcceptedInvitation;
  if (account.status !== 'invited' && !isUnactivatedCanceledAccount) {
    throw accountError(409, 'NOT_INVITED', 'Only pending invitations can be resent.');
  }
  if (!activatableRoles.has(account.role)) {
    throw accountError(409, 'NOT_INVITED', 'Only staff and guardian invitations can be resent.');
  }

  await client.query(
    'UPDATE invitations SET expires_at=LEAST(expires_at,NOW()) WHERE LOWER(email)=LOWER($1) AND accepted_at IS NULL',
    [account.email],
  );
  await client.query(
    `INSERT INTO invitations(id,token_hash,email,role,patient_id,invited_by,expires_at)
     VALUES($1,$2,$3,$4,(SELECT patient_id FROM invitations WHERE LOWER(email)=LOWER($3) ORDER BY created_at DESC LIMIT 1),$5,NOW()+INTERVAL '72 hours')`,
    [invitationId, tokenHash, account.email, account.role, invitedBy],
  );

  if (isUnactivatedCanceledAccount) {
    await client.query("UPDATE users SET status='invited',updated_at=NOW() WHERE id=$1 AND status='deactivated'", [account.id]);
  }
  return { ...account, status: 'invited' };
}
