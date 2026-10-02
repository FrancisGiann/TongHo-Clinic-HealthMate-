export async function listInAppNotifications(userId, queryFn) {
  return queryFn(
    "SELECT * FROM notifications WHERE user_id=$1 AND channel='in_app' AND type NOT IN ('immunization','immunization_reminder') ORDER BY created_at DESC LIMIT 100",
    [userId],
  );
}

export async function markInAppNotificationRead(notificationId, userId, queryFn) {
  return queryFn(
    "UPDATE notifications SET status='read',read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND user_id=$2 AND channel='in_app' RETURNING *",
    [notificationId, userId],
  );
}
