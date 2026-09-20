/**
 * Clear HealthMate+ localStorage and sessionStorage
 * Run this in browser console (F12) to immediately clear all stored data
 * 
 * Usage:
 * 1. Open browser DevTools (Press F12)
 * 2. Go to Console tab
 * 3. Copy and paste this entire script
 * 4. Press Enter
 * 5. Refresh the page
 */

console.log(' Clearing HealthMate+ storage...');

// Clear main data storage
localStorage.removeItem('schoolcare-data');
console.log('✅ Cleared: schoolcare-data');

// Clear theme preference (optional - remove // to clear)
// localStorage.removeItem('schoolcare-theme');
// console.log('✅ Cleared: schoolcare-theme');

// Clear login session (optional - remove // to logout)
// localStorage.removeItem('schoolcare-session');
// console.log('✅ Cleared: schoolcare-session');

// Clear settings authorization
sessionStorage.removeItem('settings-auth');
console.log('✅ Cleared: settings-auth');

console.log('');
console.log(' Storage cleared successfully!');
console.log(' Refresh the page to see empty data.');
console.log('');
console.log('Note: Login session and theme preference were preserved.');
console.log('      Uncomment those lines in the script to clear them too.');

// Optional: Auto-refresh after 2 seconds
setTimeout(() => {
  console.log('🔄 Auto-refreshing in 1 second...');
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}, 1000);
