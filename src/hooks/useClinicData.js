import { useCallback, useEffect, useRef, useState } from 'react';
import { saveData } from '../db/database';
import { api } from '../utils/api';
import { enqueueClinicCommit } from '../utils/clinicCommitQueue.js';

const emptyClinicData = () => ({
  schemaVersion: 1,
  settings: {},
  students: [],
  visits: [],
  immunizations: [],
  appointments: [],
  queue: [],
  inventory: [],
  dispenseLogs: [],
  stockAdjustments: [],
});

const refreshedWhilePendingMessage = 'Clinic data was refreshed while edits were pending. Review the refreshed records and reapply any changes that are missing.';
const stalePendingEditMessage = 'This edit was discarded because clinic data was refreshed before it could be saved. Review the refreshed records and reapply the edit if needed.';
const reloadBeforeSavingMessage = 'A save completed after the refresh. Newer local edits are still shown but unsaved. Note or copy them before reloading clinic data; their saves are paused to protect server data.';
const lateSaveRefreshMessage = 'A save completed after the refresh. The latest clinic data is loaded; review it and reapply any unsent edits.';

export function useClinicData(user) {
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
  const [data, setDataState] = useState(emptyClinicData);
  const [dataOwnerKey, setDataOwnerKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dataRef = useRef(data);
  const versionRef = useRef(data.schemaVersion || 1);
  const sequenceRef = useRef(0);
  const refreshEpochRef = useRef(0);
  const refreshedSequenceRef = useRef(0);
  const pendingWritesRef = useRef(0);
  const requiresReloadRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const saveQueue = useRef(Promise.resolve());

  const applyData = useCallback((value, ownerKey) => {
    if (!ownerKey || identityRef.current.sessionKey !== ownerKey) return dataRef.current;
    const normalized = saveData(value);
    dataRef.current = normalized;
    versionRef.current = normalized.schemaVersion || versionRef.current;
    setDataState(normalized);
    setDataOwnerKey(ownerKey);
    return normalized;
  }, []);

  const refreshAfterStaleWrite = useCallback(async (ownerKey) => {
    if (!ownerKey || identityRef.current.sessionKey !== ownerKey) return;
    const refreshEpoch = refreshEpochRef.current;
    const refreshedSequence = refreshedSequenceRef.current;
    const loadSequence = ++loadSequenceRef.current;
    requiresReloadRef.current = true;
    try {
      const refreshed = await api.get('/api/data');
      if (identityRef.current.sessionKey !== ownerKey || loadSequence !== loadSequenceRef.current || refreshEpoch !== refreshEpochRef.current) return;
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
      if (identityRef.current.sessionKey === ownerKey) setError(`A pending save finished after refresh, but the latest clinic data could not be loaded. ${requestError.message}`);
    }
  }, [applyData]);

  const reload = useCallback(async () => {
    if (!user || !sessionKey || identityRef.current.sessionKey !== sessionKey) return;
    const loadSequence = ++loadSequenceRef.current;
    setLoading(true);
    setError('');
    try {
      const refreshed = await api.get('/api/data');
      if (identityRef.current.sessionKey !== sessionKey || loadSequence !== loadSequenceRef.current) return;
      const hadPendingWrites = pendingWritesRef.current > 0 || requiresReloadRef.current;
      refreshEpochRef.current += 1;
      sequenceRef.current += 1;
      requiresReloadRef.current = false;
      applyData(refreshed, sessionKey);
      refreshedSequenceRef.current = sequenceRef.current;
      if (hadPendingWrites) setError(refreshedWhilePendingMessage);
    } catch (requestError) {
      if (identityRef.current.sessionKey === sessionKey && loadSequence === loadSequenceRef.current) setError(requestError.message);
    } finally {
      if (identityRef.current.sessionKey === sessionKey && loadSequence === loadSequenceRef.current) setLoading(false);
    }
  }, [applyData, sessionKey, user]);

  useEffect(() => {
    refreshEpochRef.current += 1;
    sequenceRef.current += 1;
    refreshedSequenceRef.current = sequenceRef.current;
    loadSequenceRef.current += 1;
    requiresReloadRef.current = false;
    pendingWritesRef.current = 0;
    versionRef.current = 1;
    setDataOwnerKey(null);
    const emptyData = emptyClinicData();
    setDataState(emptyData);
    dataRef.current = emptyData;
    setSaving(false);
    setError('');
    setLoading(Boolean(user));
    if (!user || !sessionKey) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadForIdentity = async () => {
      await saveQueue.current;
      if (!cancelled && identityRef.current.sessionKey === sessionKey) await reload();
    };
    loadForIdentity();
    return () => { cancelled = true; };
  }, [reload, sessionKey, user]);

  const setData = useCallback((nextData) => {
    if (!sessionKey || identityRef.current.sessionKey !== sessionKey) return dataRef.current;
    const previous = dataRef.current;
    const resolved = typeof nextData === 'function' ? nextData(previous) : nextData;
    const optimistic = applyData(resolved, sessionKey);
    const sequence = ++sequenceRef.current;
    if (user?.role !== 'school_nurse') return optimistic;

    const refreshEpoch = refreshEpochRef.current;
    pendingWritesRef.current += 1;
    let requestDispatched = false;
    setSaving(true);
    saveQueue.current = saveQueue.current
      .then(async () => {
        if (identityRef.current.sessionKey !== sessionKey) return;
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
        if (identityRef.current.sessionKey !== sessionKey) return;
        if (refreshEpoch !== refreshEpochRef.current) {
          await refreshAfterStaleWrite(sessionKey);
          return;
        }
        versionRef.current = saved.schemaVersion;
        if (sequence === sequenceRef.current) applyData(saved, sessionKey);
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
        if (identityRef.current.sessionKey !== sessionKey) return;
        if (refreshEpoch !== refreshEpochRef.current) {
          if (requestDispatched) await refreshAfterStaleWrite(sessionKey);
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
  }, [applyData, refreshAfterStaleWrite, reload, sessionKey, user?.role]);

  const commitData = useCallback(async (nextData) => {
    if (!sessionKey || identityRef.current.sessionKey !== sessionKey || user?.role !== 'school_nurse') {
      throw new Error('This account cannot save clinic changes.');
    }
    const enqueuedRefreshEpoch = refreshEpochRef.current;
    pendingWritesRef.current += 1;
    setSaving(true);
    const request = enqueueClinicCommit(saveQueue, async () => {
      let requestDispatched = false;
      let requestRefreshEpoch = enqueuedRefreshEpoch;
      try {
        if (identityRef.current.sessionKey !== sessionKey) throw new Error('Your session changed before the clinic changes could be saved.');
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
        const savePayload = applyData(resolved, sessionKey);
        const sequence = ++sequenceRef.current;
        requestRefreshEpoch = refreshEpochRef.current;
        requestDispatched = true;
        const saved = await api.put('/api/data', { data: savePayload, version: versionRef.current });
        if (identityRef.current.sessionKey !== sessionKey) throw new Error('Your session changed before the clinic changes could be confirmed.');
        if (requestRefreshEpoch !== refreshEpochRef.current) {
          const staleError = new Error(stalePendingEditMessage);
          staleError.code = 'STALE_PENDING_EDIT';
          throw staleError;
        }
        versionRef.current = saved.schemaVersion;
        if (sequence === sequenceRef.current) applyData(saved, sessionKey);
        else {
          dataRef.current = { ...dataRef.current, schemaVersion: saved.schemaVersion };
          setDataState(dataRef.current);
        }
        setError('');
        return saved;
      } catch (requestError) {
        if (identityRef.current.sessionKey !== sessionKey) throw requestError;
        if (requestRefreshEpoch !== refreshEpochRef.current) {
          if (requestDispatched) await refreshAfterStaleWrite(sessionKey);
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
  }, [applyData, refreshAfterStaleWrite, reload, sessionKey, user?.role]);

  const applyServerData = useCallback((patch) => {
    if (!sessionKey || identityRef.current.sessionKey !== sessionKey || pendingWritesRef.current > 0) return false;
    const next = { ...dataRef.current, ...patch };
    refreshEpochRef.current += 1;
    sequenceRef.current += 1;
    versionRef.current = next.schemaVersion || versionRef.current;
    requiresReloadRef.current = false;
    applyData(next, sessionKey);
    refreshedSequenceRef.current = sequenceRef.current;
    setError('');
    return true;
  }, [applyData, sessionKey]);

  const ready = Boolean(sessionKey && dataOwnerKey === sessionKey && !loading);
  return [data, setData, { loading, saving, error, reload, applyServerData, commitData, ready }];
}
