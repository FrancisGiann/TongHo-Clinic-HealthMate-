import { useCallback, useState } from 'react';
import { loadData, saveData } from '../db/database';

export function useClinicData() {
  const [data, setDataState] = useState(loadData);

  const setData = useCallback((nextData) => {
    setDataState((currentData) => {
      const resolvedData = typeof nextData === 'function' ? nextData(currentData) : nextData;
      return saveData(resolvedData);
    });
  }, []);

  return [data, setData];
}
