import { useCallback, useEffect, useRef, useState } from 'react';
import { saveData } from '../db/database';
import { api } from '../utils/api';
import { enqueueClinicCommit } from '../utils/clinicCommitQueue.js';
import { mayReusePendingScopeData, patientDirectorySearch, resolveClinicDataScope } from '../utils/clinicDataScope.js';

const emptyClinicData = () => ({
  schemaVersion: 1,
  settings: {},
  students: [],
  visits: [],
  appointments: [],
  inventory: [],
  dispenseLogs: [],
  stockAdjustments: [],
});

const refreshedWhilePendingMessage = 'Clinic data was refreshed while edits were pending. Review the refreshed records and reapply any changes that are missing.';
const stalePendingEditMessage = 'This edit was discarded because clinic data was refreshed before it could be saved. Review the refreshed records and reapply the edit if needed.';
const reloadBeforeSavingMessage = 'A save completed after the refresh. Newer local edits are still shown but unsaved. Note or copy them before reloading clinic data; their saves are paused to protect server data.';
const lateSaveRefreshMessage = 'A save completed after the refresh. The latest clinic data is loaded; review it and reapply any unsent edits.';

export function useClinicData(user, { pathname = '/', search = '' } = {}) {
  const identity = user ? `${String(user.id || user.username || '')}:${user.role}` : null;
  const identityRef = useRef({ identity: null, generation: 0, sessionKey: null });
  if (identityRef.current.identity !== identity) {
    const generation = identityRef.current.generation + 1;
    identityRef.current = {
      identity,
      generation,
      sessionKey: identity ? `${generation}:${identity}` : null,
    };
  }
  const sessionKey = identityRef.current.sessionKey;
  const resolvedScope = resolveClinicDataScope(user?.role, pathname, search);
  const scopeKind = resolvedScope.kind;
  const scopeGroupKey = sessionKey ? `${sessionKey}:${resolvedScope.group}` : null;
  const scopeRequestKey = sessionKey ? `${scopeGroupKey}:${resolvedScope.requestKey}` : null;
  const fullScope = scopeKind === 'full';
  const scopeRef = useRef({ ownerKey: null, requestKey: null });
  scopeRef.current = { ownerKey: scopeGroupKey, requestKey: scopeRequestKey };

  const [data, setDataState] = useState(emptyClinicData);
  const [dataOwnerKey, setDataOwnerKey] = useState(null);
  const [scopeDataEntry, setScopeDataEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dataRef = useRef(data);
  const dataOwnerRef = useRef(null);
  const versionRef = useRef(data.schemaVersion || 1);
  const sequenceRef = useRef(0);
  const refreshEpochRef = useRef(0);
  const refreshedSequenceRef = useRef(0);
  const pendingWritesRef = useRef(0);
  const requiresReloadRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const saveQueue = useRef(Promise.resolve());

  const applyData = useCallback((value, ownerKey) => {
    if (!ownerKey || scopeRef.current.ownerKey !== ownerKey || identityRef.current.sessionKey !== sessionKey) return dataRef.current;
    const normalized = saveData(value);
    dataRef.current = normalized;
    dataOwnerRef.current = ownerKey;
    versionRef.current = normalized.schemaVersion || versionRef.current;
    setDataState(normalized);
    setDataOwnerKey(ownerKey);
    return normalized;
  }, [sessionKey]);

  const refreshAfterStaleWrite = useCallback(async (ownerKey) => {
    if (!ownerKey || scopeRef.current.ownerKey !== ownerKey || identityRef.current.sessionKey !== sessionKey) return;
    const refreshEpoch = refreshEpochRef.current;
    const refreshedSequence = refreshedSequenceRef.current;
    const loadSequence = ++loadSequenceRef.current;
    requiresReloadRef.current = true;
    try {
      const refreshed = await api.get('/api/data');
      if (scopeRef.current.ownerKey !== ownerKey || identityRef.current.sessionKey !== sessionKey || loadSequence !== loadSequenceRef.current || refreshEpoch !== refreshEpochRef.current) return;
      if (sequenceRef.current !== refreshedSequence) {
        setError(reloadBeforeSavingMessage);
        return;
      }
      refreshEpochRef.current += 1;
      sequenceRef.current += 1;
      applyData(refreshed, ownerKey);
      refreshedSequenceRef.current = sequenceRef.current;
      requiresReloadRef.current = false;
      setError(lateSaveRefreshMessage);
    } catch (requestError) {
      if (identityRef.current.sessionKey === sessionKey && scopeRef.current.ownerKey === ownerKey) setError(`A pending save finished after refresh, but the latest clinic data could not be loaded. ${requestError.message}`);
    }
  }, [applyData, scopeGroupKey, sessionKey]);

  const reload = useCallback(async () => {
    if (!user || !sessionKey || identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) return;
    const loadSequence = ++loadSequenceRef.current;
    const requestKey = scopeRequestKey;
    setLoading(true);
    setError('');
    try {
      let refreshed;
      let scopedPayload = null;
      if (scopeKind === 'dashboard') {
        scopedPayload = await api.get('/api/nurse/dashboard');
        refreshed = { ...emptyClinicData(), ...scopedPayload };
      } else if (scopeKind === 'directory') {
        const params = patientDirectorySearch(resolvedScope.search);
        scopedPayload = await api.get(`/api/patients${params ? `?${params}` : ''}`);
        refreshed = {
          ...emptyClinicData(),
          schemaVersion: scopedPayload.schemaVersion,
          settings: scopedPayload.settings || {},
          students: scopedPayload.patients || [],
        };
      } else if (scopeKind === 'patient') {
        scopedPayload = await api.get(`/api/patients/${encodeURIComponent(resolvedScope.patientId)}`);
        refreshed = {
          ...emptyClinicData(),
          schemaVersion: scopedPayload.schemaVersion,
          settings: scopedPayload.settings || {},
          students: scopedPayload.patient ? [scopedPayload.patient] : [],
          visits: scopedPayload.visits || [],
        };
      } else if (scopeKind === 'report') {
        scopedPayload = await api.get('/api/clinic/bootstrap');
        refreshed = { ...emptyClinicData(), ...scopedPayload };
      } else {
        refreshed = await api.get('/api/data');
      }
      if (identityRef.current.sessionKey !== sessionKey
        || scopeRef.current.ownerKey !== scopeGroupKey
        || scopeRef.current.requestKey !== requestKey
        || loadSequence !== loadSequenceRef.current) return;
      const hadPendingWrites = pendingWritesRef.current > 0 || requiresReloadRef.current;
      refreshEpochRef.current += 1;
      sequenceRef.current += 1;
      requiresReloadRef.current = false;
      applyData(refreshed, scopeGroupKey);
      if (scopeKind === 'directory' || scopeKind === 'patient' || scopeKind === 'report') {
        setScopeDataEntry({ ownerKey: scopeGroupKey, requestKey, data: scopedPayload });
      } else {
        setScopeDataEntry(null);
      }
      refreshedSequenceRef.current = sequenceRef.current;
      if (hadPendingWrites) setError(refreshedWhilePendingMessage);
    } catch (requestError) {
      if (identityRef.current.sessionKey === sessionKey && scopeRef.current.ownerKey === scopeGroupKey && loadSequence === loadSequenceRef.current) setError(requestError.message);
    } finally {
      if (identityRef.current.sessionKey === sessionKey && scopeRef.current.ownerKey === scopeGroupKey && scopeRef.current.requestKey === requestKey && loadSequence === loadSequenceRef.current) setLoading(false);
    }
  }, [applyData, resolvedScope.patientId, resolvedScope.search, scopeGroupKey, scopeKind, scopeRequestKey, sessionKey, user]);

  const refreshInBackground = useCallback(async () => {
    if (!user || !sessionKey || !fullScope || scopeRef.current.ownerKey !== scopeGroupKey || identityRef.current.sessionKey !== sessionKey) return false;
    await saveQueue.current;
    if (scopeRef.current.ownerKey !== scopeGroupKey || identityRef.current.sessionKey !== sessionKey || pendingWritesRef.current > 0 || requiresReloadRef.current) return false;

    const loadSequence = ++loadSequenceRef.current;
    const refreshEpoch = refreshEpochRef.current;
    const sequence = sequenceRef.current;
    setError('');
    try {
      const refreshed = await api.get('/api/data');
      if (scopeRef.current.ownerKey !== scopeGroupKey || identityRef.current.sessionKey !== sessionKey || loadSequence !== loadSequenceRef.current) return false;
      if (refreshEpochRef.current !== refreshEpoch || sequenceRef.current !== sequence || pendingWritesRef.current > 0 || requiresReloadRef.current) return false;

      refreshEpochRef.current += 1;
      sequenceRef.current += 1;
      applyData(refreshed, scopeGroupKey);
      refreshedSequenceRef.current = sequenceRef.current;
      requiresReloadRef.current = false;
      return true;
    } catch (requestError) {
      if (identityRef.current.sessionKey === sessionKey && scopeRef.current.ownerKey === scopeGroupKey && loadSequence === loadSequenceRef.current) setError(requestError.message);
      throw requestError;
    }
  }, [applyData, fullScope, scopeGroupKey, sessionKey, user]);

  useEffect(() => {
    refreshEpochRef.current += 1;
    sequenceRef.current += 1;
    refreshedSequenceRef.current = sequenceRef.current;
    loadSequenceRef.current += 1;
    requiresReloadRef.current = false;
    pendingWritesRef.current = 0;
    versionRef.current = 1;
    setDataOwnerKey(null);
    dataOwnerRef.current = null;
    setScopeDataEntry(null);
    const emptyData = emptyClinicData();
    setDataState(emptyData);
    dataRef.current = emptyData;
    setSaving(false);
    setError('');
    setLoading(Boolean(user));
    if (!user || !sessionKey) setLoading(false);
  }, [sessionKey]);

  useEffect(() => {
    if (!user || !sessionKey) return undefined;
    let active = true;
    const loadForScope = async () => {
      await saveQueue.current;
      if (active && identityRef.current.sessionKey === sessionKey && scopeRef.current.ownerKey === scopeGroupKey) await reload();
    };
    loadForScope();
    return () => { active = false; };
  }, [reload, scopeGroupKey, scopeRequestKey, sessionKey, user]);

  const setData = useCallback((nextData) => {
    if (!fullScope || !sessionKey || identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) return dataRef.current;
    const previous = dataRef.current;
    const resolved = typeof nextData === 'function' ? nextData(previous) : nextData;
    const optimistic = applyData(resolved, scopeGroupKey);
    const sequence = ++sequenceRef.current;
    if (user?.role !== 'school_nurse') return optimistic;

    const refreshEpoch = refreshEpochRef.current;
    pendingWritesRef.current += 1;
    let requestDispatched = false;
    setSaving(true);
    saveQueue.current = saveQueue.current
      .then(async () => {
        if (identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) return;
        if (requiresReloadRef.current) {
          const reloadError = new Error(reloadBeforeSavingMessage);
          reloadError.code = 'RELOAD_REQUIRED';
          throw reloadError;
        }
        if (refreshEpoch !== refreshEpochRef.current) {
          const staleEditError = new Error(stalePendingEditMessage);
          staleEditError.code = 'STALE_PENDING_EDIT';
          throw staleEditError;
        }
        requestDispatched = true;
        const saved = await api.put('/api/data', { data: optimistic, version: versionRef.current });
        if (identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) return;
        if (refreshEpoch !== refreshEpochRef.current) {
          await refreshAfterStaleWrite(scopeGroupKey);
          return;
        }
        versionRef.current = saved.schemaVersion;
        if (sequence === sequenceRef.current) applyData(saved, scopeGroupKey);
        else {
          dataRef.current = { ...dataRef.current, schemaVersion: saved.schemaVersion };
          setDataState(dataRef.current);
        }
        setError('');
      })
      .catch(async (requestError) => {
        if (requestError.code === 'RELOAD_REQUIRED') {
          setError(reloadBeforeSavingMessage);
          return;
        }
        if (identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) return;
        if (refreshEpoch !== refreshEpochRef.current) {
          if (requestDispatched) await refreshAfterStaleWrite(scopeGroupKey);
          else setError(stalePendingEditMessage);
          return;
        }
        if (requestError.code === 'STALE_PENDING_EDIT') {
          setError(stalePendingEditMessage);
          return;
        }
        setError(requestError.message);
        await reload();
      })
      .finally(() => {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        setSaving(pendingWritesRef.current > 0);
      });
    return optimistic;
  }, [applyData, fullScope, refreshAfterStaleWrite, reload, scopeGroupKey, sessionKey, user?.role]);

  const commitData = useCallback(async (nextData) => {
    if (!fullScope || !sessionKey || identityRef.current.sessionKey !== sessionKey || user?.role !== 'school_nurse' || scopeRef.current.ownerKey !== scopeGroupKey) {
      throw new Error('A complete clinic snapshot is required to save clinic changes.');
    }
    const enqueuedRefreshEpoch = refreshEpochRef.current;
    pendingWritesRef.current += 1;
    setSaving(true);
    const request = enqueueClinicCommit(saveQueue, async () => {
      let requestDispatched = false;
      let requestRefreshEpoch = enqueuedRefreshEpoch;
      try {
        if (identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) throw new Error('Your clinic view changed before the changes could be saved.');
        if (requiresReloadRef.current) {
          const reloadError = new Error(reloadBeforeSavingMessage);
          reloadError.code = 'RELOAD_REQUIRED';
          throw reloadError;
        }
        if (enqueuedRefreshEpoch !== refreshEpochRef.current) {
          const staleError = new Error(stalePendingEditMessage);
          staleError.code = 'STALE_PENDING_EDIT';
          throw staleError;
        }
        const resolved = typeof nextData === 'function' ? nextData(dataRef.current) : nextData;
        const savePayload = applyData(resolved, scopeGroupKey);
        const sequence = ++sequenceRef.current;
        requestRefreshEpoch = refreshEpochRef.current;
        requestDispatched = true;
        const saved = await api.put('/api/data', { data: savePayload, version: versionRef.current });
        if (identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) throw new Error('Your clinic view changed before the clinic changes could be confirmed.');
        if (requestRefreshEpoch !== refreshEpochRef.current) {
          const staleError = new Error(stalePendingEditMessage);
          staleError.code = 'STALE_PENDING_EDIT';
          throw staleError;
        }
        versionRef.current = saved.schemaVersion;
        if (sequence === sequenceRef.current) applyData(saved, scopeGroupKey);
        else {
          dataRef.current = { ...dataRef.current, schemaVersion: saved.schemaVersion };
          setDataState(dataRef.current);
        }
        setError('');
        return saved;
      } catch (requestError) {
        if (identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey) throw requestError;
        if (requestRefreshEpoch !== refreshEpochRef.current) {
          if (requestDispatched) await refreshAfterStaleWrite(scopeGroupKey);
          else setError(stalePendingEditMessage);
        } else if (requestError.code === 'RELOAD_REQUIRED') {
          setError(reloadBeforeSavingMessage);
        } else if (requestError.code === 'STALE_PENDING_EDIT') {
          setError(stalePendingEditMessage);
        } else {
          await reload();
          setError(requestError.message || 'Clinic changes could not be saved.');
        }
        throw requestError;
      } finally {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        setSaving(pendingWritesRef.current > 0);
      }
    });

    return request;
  }, [applyData, fullScope, refreshAfterStaleWrite, reload, scopeGroupKey, sessionKey, user?.role]);

  const applyServerData = useCallback((patch) => {
    if (!fullScope || !sessionKey || identityRef.current.sessionKey !== sessionKey || scopeRef.current.ownerKey !== scopeGroupKey || pendingWritesRef.current > 0) return false;
    const next = { ...dataRef.current, ...patch };
    refreshEpochRef.current += 1;
    sequenceRef.current += 1;
    versionRef.current = next.schemaVersion || versionRef.current;
    requiresReloadRef.current = false;
    applyData(next, scopeGroupKey);
    refreshedSequenceRef.current = sequenceRef.current;
    setError('');
    return true;
  }, [applyData, fullScope, scopeGroupKey, sessionKey]);

  const hasData = Boolean(sessionKey && dataOwnerKey === scopeGroupKey);
  const ready = hasData && !loading;
  const scopeDataReady = scopeDataEntry?.ownerKey === scopeGroupKey && scopeDataEntry?.requestKey === scopeRequestKey;
  const sameOwnerDirectoryPending = mayReusePendingScopeData(scopeKind, scopeDataEntry?.ownerKey, scopeGroupKey);
  const scopedData = scopeDataReady || sameOwnerDirectoryPending ? scopeDataEntry.data : null;
  const scopeLoading = loading || (scopeKind === 'directory' && !scopeDataReady);
  return [data, setData, { loading, saving, error, reload, refreshInBackground, applyServerData, commitData, ready, hasData, scopeKind, scopeData: scopedData, scopeDataReady, scopeLoading }];
}

export default useClinicData;
