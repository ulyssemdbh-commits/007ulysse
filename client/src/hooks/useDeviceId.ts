import { useState, useEffect } from "react";

interface UseDeviceIdOptions {
  prefix?: string;
}

export function useDeviceId(options: UseDeviceIdOptions = {}) {
  const { prefix = "device" } = options;
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const storageKey = "ulysse_device_id";
    const savedDeviceId = localStorage.getItem(storageKey);
    
    if (savedDeviceId) {
      setDeviceId(savedDeviceId);
    } else {
      const newId = `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(storageKey, newId);
      setDeviceId(newId);
    }
  }, [prefix]);

  return deviceId;
}
