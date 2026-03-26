import { useRef, useMemo, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Play, Pause } from "lucide-react";
import { motion } from "framer-motion";

interface SimulationObject {
  id: string;
  type: "cube" | "sphere" | "cylinder";
  position: [number, number, number];
  color: string;
  label?: string;
}

interface SimulationSceneProps {
  objects: SimulationObject[];
  isPlaying: boolean;
}

function SimulationScene({ objects, isPlaying }: SimulationSceneProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current && isPlaying) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.2;
    }
  });

  return (
    <group ref={groupRef}>
      {objects.map((obj) => {
        const meshProps = {
          key: obj.id,
          position: obj.position,
        };

        return (
          <mesh {...meshProps}>
            {obj.type === "cube" && <boxGeometry args={[1, 1, 1]} />}
            {obj.type === "sphere" && <sphereGeometry args={[0.5, 32, 32]} />}
            {obj.type === "cylinder" && <cylinderGeometry args={[0.5, 0.5, 1, 32]} />}
            <meshStandardMaterial color={obj.color} />
          </mesh>
        );
      })}
    </group>
  );
}

interface SimulationViewProps {
  title?: string;
  objects?: SimulationObject[];
  onClose?: () => void;
}

export function SimulationView({ 
  title = "Simulation 3D", 
  objects = [],
  onClose 
}: SimulationViewProps) {
  const [isPlaying, setIsPlaying] = useState(true);

  const defaultObjects: SimulationObject[] = useMemo(() => [
    { id: "1", type: "cube", position: [-2, 0, 0], color: "#10b981", label: "Module A" },
    { id: "2", type: "sphere", position: [0, 0, 0], color: "#8b5cf6", label: "Centre" },
    { id: "3", type: "cylinder", position: [2, 0, 0], color: "#06b6d4", label: "Module B" },
  ], []);

  const displayObjects = objects.length > 0 ? objects : defaultObjects;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed bottom-24 left-4 right-4 md:left-auto md:right-4 z-40 w-auto md:w-[500px]"
    >
      <Card className="bg-card/90 backdrop-blur-xl border-border shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsPlaying(!isPlaying)}
              className="h-6 w-6"
              data-testid="button-toggle-simulation"
            >
              {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </Button>
            {onClose && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="h-6 w-6"
                data-testid="button-close-simulation"
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64 md:h-80 rounded-lg overflow-hidden bg-gradient-to-b from-slate-900 to-slate-800">
            <Canvas camera={{ position: [5, 3, 5], fov: 50 }}>
              <ambientLight intensity={0.4} />
              <pointLight position={[10, 10, 10]} intensity={1} />
              <pointLight position={[-10, -10, -10]} intensity={0.3} color="#8b5cf6" />
              <SimulationScene objects={displayObjects} isPlaying={isPlaying} />
              <OrbitControls enableZoom={true} enablePan={false} />
              <Grid 
                args={[10, 10]} 
                cellSize={1} 
                cellThickness={0.5} 
                cellColor="#334155" 
                sectionSize={5}
                sectionThickness={1}
                sectionColor="#475569"
                fadeDistance={25}
                fadeStrength={1}
                followCamera={false}
                infiniteGrid={true}
              />
            </Canvas>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Utilisez la souris pour faire pivoter la vue
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
