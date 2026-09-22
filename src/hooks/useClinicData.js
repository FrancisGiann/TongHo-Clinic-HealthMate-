import { useCallback, useEffect, useRef, useState } from 'react';
import { loadData, saveData } from '../db/database';
import { api } from '../utils/api';

export function useClinicData(user) {
  const [data, setDataState] = useState(loadData);
  const [loading, setLoading] = useState(Boolean(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dataRef = useRef(data);
  const versionRef = useRef(data.schemaVersion || 1);
  const sequenceRef = useRef(0);
  const saveQueue = useRef(Promise.resolve());

  const applyData = useCallback((value) => {
    const normalized = saveData(value);
    dataRef.current = normalized;
    versionRef.current = normalized.schemaVersion || versionRef.current;
    setDataState(normalized);
    return normalized;
  }, []);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      applyData(await api.get('/api/data'));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [applyData, user]);

  useEffect(() => {
    if (user) reload();
  }, [reload, user]);

  const setData = useCallback((nextData) => {
    const previous = dataRef.current;
    const resolved = typeof nextData === 'function' ? nextData(previous) : nextData;
    const optimistic = applyData(resolved);
    const sequence = ++sequenceRef.current;
    if (!['school_nurse', 'system_administrator'].includes(user?.role)) return optimistic;

    setSaving(true);
    saveQueue.current = saveQueue.current
      .then(async () => {
        const saved = await api.put('/api/data', { data: optimistic, version: versionRef.current });
        versionRef.current = saved.schemaVersion;
        if (sequence === sequenceRef.current) applyData(saved);
        else {
          dataRef.current = { ...dataRef.current, schemaVersion: saved.schemaVersion };
          setDataState(dataRef.current);
        }
        setError('');
      })
      .catch(async (requestError) => {
        setError(requestError.message);
        await reload();
      })
      .finally(() => setSaving(false));
    return optimistic;
  }, [applyData, reload, user?.role]);

  return [data, setData, { loading, saving, error, reload }];
}
