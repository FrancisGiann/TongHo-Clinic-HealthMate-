const INTERNAL_ORIGIN = 'https://healthmate.local';

export function getSafeReturnPath(location) {
  if (!location || typeof location !== 'object') return '/';

  const pathname = typeof location.pathname === 'string' ? location.pathname : '';
  const search = typeof location.search === 'string' ? location.search : '';
  const hash = typeof location.hash === 'string' ? location.hash : '';
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) return '/';

  try {
    const target = new URL(`${pathname}${search}${hash}`, INTERNAL_ORIGIN);
    if (target.origin !== INTERNAL_ORIGIN || target.pathname === '/login') return '/';

    if (target.searchParams.has('activate')) {
      target.searchParams.delete('activate');
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}
