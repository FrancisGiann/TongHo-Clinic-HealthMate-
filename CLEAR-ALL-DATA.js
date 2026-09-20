/**
 * ============================================
 * CLEAR ALL DATA - HealthMate+ Complete Reset
 * ============================================
 * 
 * This script clears ALL stored data and resets the app to empty state.
 * 
 * USAGE:
 * 1. Open your app in the browser (http://localhost:5174/)
 * 2. Press F12 to open DevTools
 * 3. Go to Console tab
 * 4. Copy and paste this ENTIRE script
 * 5. Press Enter
 * 6. Page will auto-reload with empty data
 */

console.clear();
console.log('🧹 HealthMate+ Complete Data Reset');
console.log('═══════════════════════════════════════');
console.log('');

// Clear main application data
if (localStorage.getItem('schoolcare-data')) {
  localStorage.removeItem('schoolcare-data');
  console.log('✅ Cleared: Student & clinic data');
} else {
  console.log('ℹ️  No student/clinic data found');
}

// Clear login session (optional - will require re-login)
if (localStorage.getItem('schoolcare-session')) {
  localStorage.removeItem('schoolcare-session');
  console.log('✅ Cleared: Login session (you will need to login again)');
}

// Clear theme preference (optional - will reset to light mode)
if (localStorage.getItem('schoolcare-theme')) {
  const theme = localStorage.getItem('schoolcare-theme');
  console.log(`ℹ️  Theme preserved: ${theme} mode`);
  // Uncomment next line to also clear theme:
  // localStorage.removeItem('schoolcare-theme');
}

// Clear settings authorization
if (sessionStorage.getItem('settings-auth')) {
  sessionStorage.removeItem('settings-auth');
  console.log('✅ Cleared: Settings authorization');
}

console.log('');
console.log('═══════════════════════════════════════');
console.log(' All data cleared successfully!');
console.log('');
console.log(' What to expect after reload:');
console.log('   • Students: 0 (empty list)');
console.log('   • Visits: 0 (no visits today)');
console.log('   • Inventory: 0 items');
console.log('   • All records: empty');
console.log('');
console.log('  You will need to login again');
console.log('   Username: nurse.santos');
console.log('   Password: HealthMate2025!');
console.log('');
console.log(' Reloading in 3 seconds...');

// Auto-reload after 3 seconds
setTimeout(() => {
  console.log(' Reloading now...');
  window.location.reload();
}, 3000);
