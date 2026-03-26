import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bluetooth, Mic, Volume2, Check, RefreshCw, Smartphone, TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: string;
}

interface VoiceDevicePanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedInputId: string;
  selectedOutputId: string;
  onSelectInput: (deviceId: string, label: string) => void;
  onSelectOutput: (deviceId: string, label: string) => void;
  onTestAudio: () => void;
  isTestingAudio: boolean;
  sinkIdSupported: boolean;
  isIOS: boolean;
}

const BT_KEYWORDS = [
  "bluetooth", "airpod", "earpod", "buds", "wireless", "bt", 
  "headphone", "casque", "earphone", "sena", "smh", "wf-c510", 
  "wf-c", "sony", "jabra", "bose", "beats"
];

export function VoiceDevicePanel({
  isOpen,
  onClose,
  selectedInputId,
  selectedOutputId,
  onSelectInput,
  onSelectOutput,
  onTestAudio,
  isTestingAudio,
  sinkIdSupported,
  isIOS,
}: VoiceDevicePanelProps) {
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [micBluetoothStatus, setMicBluetoothStatus] = useState<"connected" | "none" | "unknown">("unknown");
  const [speakerBluetoothStatus, setSpeakerBluetoothStatus] = useState<"connected" | "none" | "unknown">("unknown");
  
  const isBluetooth = (label: string) => 
    BT_KEYWORDS.some(kw => label.toLowerCase().includes(kw));
  
  const refreshDevices = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const inputs = devices
        .filter(d => d.kind === "audioinput" && d.label)
        .map(d => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
      
      const outputs = devices
        .filter(d => d.kind === "audiooutput" && d.label)
        .map(d => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
      
      setInputDevices(inputs);
      setOutputDevices(outputs);
      
      const hasBtInput = inputs.some(d => isBluetooth(d.label));
      const hasBtOutput = outputs.some(d => isBluetooth(d.label));
      
      setMicBluetoothStatus(hasBtInput ? "connected" : "none");
      setSpeakerBluetoothStatus(hasBtOutput ? "connected" : isIOS && hasBtInput ? "connected" : "none");
      
    } catch (err) {
      console.error("[DevicePanel] Failed to enumerate devices:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [isIOS]);
  
  useEffect(() => {
    if (isOpen) {
      refreshDevices();
    }
  }, [isOpen, refreshDevices]);
  
  const triggerHaptic = () => {
    if ("vibrate" in navigator) {
      navigator.vibrate(10);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="w-full max-w-lg bg-gray-900 rounded-t-3xl p-6 max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-white">Peripheriques audio</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-gray-400 hover:text-white"
              data-testid="button-close-device-panel"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className={cn(
              "flex items-center gap-3 p-4 rounded-xl",
              micBluetoothStatus === "connected" ? "bg-green-900/30 border border-green-700" : "bg-gray-800"
            )}>
              {micBluetoothStatus === "connected" ? (
                <Bluetooth className="w-5 h-5 text-green-400" />
              ) : (
                <Mic className="w-5 h-5 text-gray-400" />
              )}
              <div>
                <p className="text-sm text-white font-medium">Micro</p>
                <p className="text-xs text-gray-400">
                  {micBluetoothStatus === "connected" ? "Bluetooth" : "Interne"}
                </p>
              </div>
            </div>
            
            <div className={cn(
              "flex items-center gap-3 p-4 rounded-xl",
              speakerBluetoothStatus === "connected" ? "bg-blue-900/30 border border-blue-700" : "bg-gray-800"
            )}>
              {speakerBluetoothStatus === "connected" ? (
                <Bluetooth className="w-5 h-5 text-blue-400" />
              ) : (
                <Volume2 className="w-5 h-5 text-gray-400" />
              )}
              <div>
                <p className="text-sm text-white font-medium">Sortie</p>
                <p className="text-xs text-gray-400">
                  {speakerBluetoothStatus === "connected" ? "Bluetooth" : "Interne"}
                </p>
              </div>
            </div>
          </div>
          
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400 flex items-center gap-2">
                <Mic className="w-4 h-4" /> Microphones
              </p>
              <span className="text-xs text-green-400">{inputDevices.length} disponible(s)</span>
            </div>
            
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {inputDevices.map((device, i) => {
                const isSelected = selectedInputId === device.deviceId;
                const hasBt = isBluetooth(device.label);
                
                return (
                  <button
                    key={device.deviceId || i}
                    onClick={() => {
                      triggerHaptic();
                      onSelectInput(device.deviceId, device.label);
                    }}
                    className={cn(
                      "w-full p-3 rounded-lg flex items-center gap-3 text-left transition-all",
                      isSelected 
                        ? "bg-green-600 border border-green-500" 
                        : hasBt 
                          ? "bg-green-900/20 border border-green-800 hover:bg-green-900/30" 
                          : "bg-gray-800 hover:bg-gray-700"
                    )}
                    data-testid={`button-input-device-${i}`}
                  >
                    {isSelected ? (
                      <Check className="w-5 h-5 text-white" />
                    ) : hasBt ? (
                      <Bluetooth className="w-5 h-5 text-green-400" />
                    ) : (
                      <Mic className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="text-sm text-white truncate flex-1">
                      {device.label || "Micro inconnu"}
                    </span>
                    {isSelected && <span className="text-xs text-green-200">Actif</span>}
                  </button>
                );
              })}
              
              {inputDevices.length === 0 && (
                <p className="text-gray-500 text-center py-3 text-sm">Aucun micro detecte</p>
              )}
            </div>
          </div>
          
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400 flex items-center gap-2">
                <Volume2 className="w-4 h-4" /> Sorties audio
              </p>
              {!sinkIdSupported && (
                <span className="text-xs text-yellow-400">iOS: Control Center</span>
              )}
            </div>
            
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {outputDevices.map((device, i) => {
                const isSelected = selectedOutputId === device.deviceId;
                const hasBt = isBluetooth(device.label);
                
                return (
                  <button
                    key={device.deviceId || i}
                    onClick={() => {
                      triggerHaptic();
                      onSelectOutput(device.deviceId, device.label);
                    }}
                    disabled={!sinkIdSupported}
                    className={cn(
                      "w-full p-3 rounded-lg flex items-center gap-3 text-left transition-all",
                      !sinkIdSupported && "opacity-50 cursor-not-allowed",
                      isSelected 
                        ? "bg-blue-600 border border-blue-500" 
                        : hasBt 
                          ? "bg-blue-900/20 border border-blue-800 hover:bg-blue-900/30" 
                          : "bg-gray-800 hover:bg-gray-700"
                    )}
                    data-testid={`button-output-device-${i}`}
                  >
                    {isSelected ? (
                      <Check className="w-5 h-5 text-white" />
                    ) : hasBt ? (
                      <Bluetooth className="w-5 h-5 text-blue-400" />
                    ) : (
                      <Volume2 className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="text-sm text-white truncate flex-1">
                      {device.label || "Sortie inconnue"}
                    </span>
                    {isSelected && <span className="text-xs text-blue-200">Actif</span>}
                  </button>
                );
              })}
              
              {outputDevices.length === 0 && (
                <div className="text-center py-4">
                  {isIOS ? (
                    <div className="space-y-2">
                      <Smartphone className="w-8 h-8 text-gray-500 mx-auto" />
                      <p className="text-gray-400 text-sm">Sur iOS, utilisez le Control Center</p>
                      <p className="text-gray-500 text-xs">
                        Glissez depuis le coin superieur droit et maintenez le controle audio
                      </p>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">Aucune sortie detectee</p>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={refreshDevices}
              disabled={isRefreshing}
              className="flex-1 bg-gray-800 border-gray-700 text-white"
              data-testid="button-refresh-devices"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin")} />
              Actualiser
            </Button>
            
            <Button
              onClick={onTestAudio}
              disabled={isTestingAudio}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              data-testid="button-test-audio"
            >
              <TestTube className={cn("w-4 h-4 mr-2", isTestingAudio && "animate-pulse")} />
              {isTestingAudio ? "Test..." : "Tester le son"}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
