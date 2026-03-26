import { useRef, useMemo, useState, useEffect, Component, ReactNode, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, Float } from "@react-three/drei";
import * as THREE from "three";
import { ConversationMood, moodColorMap } from "@/lib/mood";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type OrbVisualState = 
  | "idle"           // Repos attentif - disponible
  | "thinking"       // Reflexion/traitement local
  | "searching"      // Recherche web/acces externe
  | "analyzing"      // Analyse approfondie/cross-check
  | "speaking"       // Reponse vocale
  | "listening"      // Ecoute active
  | "alert"          // Alerte/notification
  | "success"        // Action reussie
  | "error";         // Erreur

interface OrbProps {
  isActive?: boolean;
  isSpeaking?: boolean;
  isListening?: boolean;
  isWakeWordActive?: boolean;
  isSearching?: boolean;
  isAnalyzing?: boolean;
  mood?: ConversationMood;
  orbColor?: string;
  orbIntensity?: number;
  isPaused?: boolean;
  reducedMotion?: boolean;
}

const STATE_COLORS = {
  idle: { primary: "#1e3a5f", secondary: "#6b21a8", accent: "#4c1d95" },
  thinking: { primary: "#1e3a8a", secondary: "#7c3aed", accent: "#5b21b6" },
  searching: { primary: "#1e40af", secondary: "#7c3aed", accent: "#06b6d4" },
  analyzing: { primary: "#059669", secondary: "#7c3aed", accent: "#10b981" },
  speaking: { primary: "#10b981", secondary: "#34d399", accent: "#6ee7b7" },
  listening: { primary: "#8b5cf6", secondary: "#a78bfa", accent: "#c4b5fd" },
  alert: { primary: "#f59e0b", secondary: "#fbbf24", accent: "#fcd34d" },
  success: { primary: "#22c55e", secondary: "#4ade80", accent: "#86efac" },
  error: { primary: "#ef4444", secondary: "#f87171", accent: "#fca5a5" },
};

function ExternalRays({ color, count, isActive }: { color: string; count: number; isActive: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const raysRef = useRef<THREE.Mesh[]>([]);
  
  useFrame((state) => {
    if (groupRef.current && isActive) {
      groupRef.current.rotation.z = state.clock.elapsedTime * 0.5;
      raysRef.current.forEach((ray, i) => {
        if (ray) {
          const phase = (i / count) * Math.PI * 2;
          const pulse = Math.sin(state.clock.elapsedTime * 3 + phase);
          ray.scale.y = 0.5 + pulse * 0.5;
          ray.position.y = 1.8 + pulse * 0.3;
          (ray.material as THREE.MeshBasicMaterial).opacity = 0.3 + pulse * 0.4;
        }
      });
    }
  });

  if (!isActive) return null;

  return (
    <group ref={groupRef}>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2;
        return (
          <mesh
            key={i}
            ref={(el) => { if (el) raysRef.current[i] = el; }}
            position={[Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, 0]}
            rotation={[0, 0, angle + Math.PI / 2]}
          >
            <planeGeometry args={[0.03, 0.4]} />
            <meshBasicMaterial 
              color={color} 
              transparent 
              opacity={0.5} 
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function SatelliteParticles({ color, count, isActive }: { color: string; count: number; isActive: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  
  const particles = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => ({
      angle: (i / count) * Math.PI * 2,
      radius: 1.6 + Math.random() * 0.3,
      speed: 0.5 + Math.random() * 0.5,
      size: 0.03 + Math.random() * 0.02,
      yOffset: (Math.random() - 0.5) * 0.4,
    }));
  }, [count]);

  useFrame((state) => {
    if (groupRef.current && isActive) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.3;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.2;
    }
  });

  if (!isActive) return null;

  return (
    <group ref={groupRef}>
      {particles.map((p, i) => (
        <mesh 
          key={i} 
          position={[
            Math.cos(p.angle) * p.radius,
            p.yOffset,
            Math.sin(p.angle) * p.radius
          ]}
        >
          <sphereGeometry args={[p.size, 8, 8]} />
          <meshBasicMaterial 
            color={color} 
            transparent 
            opacity={0.8}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

function PulsingHalo({ color, size, isActive, speed = 1 }: { color: string; size: number; isActive: boolean; speed?: number }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const [scale, setScale] = useState(1);
  
  useFrame((state) => {
    if (ringRef.current && isActive) {
      const pulse = (Math.sin(state.clock.elapsedTime * speed * 2) + 1) / 2;
      const newScale = 1 + pulse * 0.3;
      ringRef.current.scale.setScalar(newScale);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.6 - pulse * 0.4;
    }
  });

  if (!isActive) return null;

  return (
    <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[size, 0.02, 16, 64]} />
      <meshBasicMaterial 
        color={color} 
        transparent 
        opacity={0.5}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function InnerCore({ 
  colors, 
  intensity, 
  state,
  breatheSpeed 
}: { 
  colors: { primary: string; secondary: string; accent: string }; 
  intensity: number; 
  state: OrbVisualState;
  breatheSpeed: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  
  const gradientShader = useMemo(() => ({
    uniforms: {
      color1: { value: new THREE.Color(colors.primary) },
      color2: { value: new THREE.Color(colors.secondary) },
      time: { value: 0 },
      intensity: { value: intensity / 100 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color1;
      uniform vec3 color2;
      uniform float time;
      uniform float intensity;
      varying vec2 vUv;
      varying vec3 vNormal;
      
      void main() {
        float swirl = sin(vUv.x * 3.14159 + time * 0.5) * cos(vUv.y * 3.14159 - time * 0.3);
        float gradient = (vUv.y + swirl * 0.2) * 0.5 + 0.5;
        vec3 color = mix(color1, color2, gradient);
        
        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
        color += fresnel * intensity * 0.5;
        
        gl_FragColor = vec4(color, 0.95);
      }
    `,
  }), [colors.primary, colors.secondary, intensity]);
  
  useFrame((state) => {
    if (meshRef.current) {
      const pulse = Math.sin(state.clock.elapsedTime * breatheSpeed) * 0.05;
      meshRef.current.scale.setScalar(0.7 + pulse);
    }
    if (materialRef.current) {
      materialRef.current.uniforms.time.value = state.clock.elapsedTime;
      materialRef.current.uniforms.color1.value = new THREE.Color(colors.primary);
      materialRef.current.uniforms.color2.value = new THREE.Color(colors.secondary);
    }
  });

  return (
    <Sphere ref={meshRef} args={[0.9, 64, 64]}>
      <shaderMaterial
        ref={materialRef}
        attach="material"
        args={[gradientShader]}
        transparent
      />
    </Sphere>
  );
}

function OuterGlow({ 
  colors, 
  intensity, 
  state,
  distort,
  speed 
}: { 
  colors: { primary: string; secondary: string; accent: string }; 
  intensity: number; 
  state: OrbVisualState;
  distort: number;
  speed: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.1;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.15;
    }
  });

  return (
    <Sphere ref={meshRef} args={[1.3, 64, 64]}>
      <MeshDistortMaterial
        color={colors.secondary}
        attach="material"
        distort={distort}
        speed={speed}
        roughness={0.1}
        metalness={0.9}
        transparent
        opacity={0.25}
        emissive={colors.accent}
        emissiveIntensity={intensity / 400}
      />
    </Sphere>
  );
}

function AnimatedOrb({ 
  isActive, 
  isSpeaking, 
  isListening, 
  isWakeWordActive, 
  isSearching = false,
  isAnalyzing = false,
  mood = "neutral", 
  orbColor, 
  orbIntensity = 50, 
  isPaused = false, 
  reducedMotion = false 
}: OrbProps) {
  const groupRef = useRef<THREE.Group>(null);
  const moodColors = moodColorMap[mood];
  
  const visualState = useMemo((): OrbVisualState => {
    if (isSpeaking) return "speaking";
    if (isListening) return "listening";
    if (isWakeWordActive) return "alert";
    if (isAnalyzing) return "analyzing";
    if (isSearching) return "searching";
    if (isActive) return "thinking";
    return "idle";
  }, [isActive, isSpeaking, isListening, isWakeWordActive, isSearching, isAnalyzing]);

  const colors = useMemo(() => {
    if (orbColor) {
      return {
        primary: orbColor,
        secondary: STATE_COLORS[visualState].secondary,
        accent: STATE_COLORS[visualState].accent,
      };
    }
    return STATE_COLORS[visualState];
  }, [visualState, orbColor]);

  const intensityMultiplier = orbIntensity / 50;
  
  const animationParams = useMemo(() => {
    const params = {
      idle: { distort: 0.15, speed: 1, breathe: 0.8, showRays: false, showParticles: false, showHalo: false },
      thinking: { distort: 0.25, speed: 2, breathe: 1.2, showRays: false, showParticles: false, showHalo: true },
      searching: { distort: 0.3, speed: 2.5, breathe: 1.5, showRays: true, showParticles: false, showHalo: true },
      analyzing: { distort: 0.2, speed: 1.8, breathe: 1.3, showRays: false, showParticles: true, showHalo: true },
      speaking: { distort: 0.4, speed: 4, breathe: 2.5, showRays: false, showParticles: false, showHalo: true },
      listening: { distort: 0.35, speed: 3, breathe: 2, showRays: false, showParticles: false, showHalo: true },
      alert: { distort: 0.45, speed: 5, breathe: 3, showRays: true, showParticles: true, showHalo: true },
      success: { distort: 0.2, speed: 2, breathe: 1.5, showRays: false, showParticles: true, showHalo: true },
      error: { distort: 0.35, speed: 3.5, breathe: 2.5, showRays: false, showParticles: false, showHalo: true },
    };
    
    const p = params[visualState];
    return {
      distort: (reducedMotion || isPaused) ? 0.1 : p.distort * intensityMultiplier,
      speed: (reducedMotion || isPaused) ? 0.5 : p.speed,
      breathe: (reducedMotion || isPaused) ? 0.3 : p.breathe,
      showRays: !reducedMotion && !isPaused && p.showRays,
      showParticles: !reducedMotion && !isPaused && p.showParticles,
      showHalo: !reducedMotion && !isPaused && p.showHalo,
    };
  }, [visualState, intensityMultiplier, reducedMotion, isPaused]);

  useFrame((state) => {
    if (groupRef.current && !isPaused && !reducedMotion) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      <Float 
        speed={reducedMotion || isPaused ? 0 : animationParams.breathe} 
        rotationIntensity={reducedMotion ? 0 : 0.2} 
        floatIntensity={reducedMotion ? 0 : 0.3}
      >
        <InnerCore 
          colors={colors}
          intensity={orbIntensity}
          state={visualState}
          breatheSpeed={animationParams.breathe}
        />
        
        <OuterGlow
          colors={colors}
          intensity={orbIntensity}
          state={visualState}
          distort={animationParams.distort}
          speed={animationParams.speed}
        />
      </Float>
      
      <ExternalRays 
        color={colors.accent} 
        count={12} 
        isActive={animationParams.showRays} 
      />
      
      <SatelliteParticles 
        color={colors.accent} 
        count={8} 
        isActive={animationParams.showParticles} 
      />
      
      <PulsingHalo 
        color={colors.accent} 
        size={1.6} 
        isActive={animationParams.showHalo}
        speed={animationParams.breathe}
      />
      
      {visualState === "searching" && (
        <PulsingHalo 
          color={colors.accent} 
          size={1.9} 
          isActive={true}
          speed={animationParams.breathe * 1.5}
        />
      )}
    </group>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class WebGLErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function FallbackOrb({ 
  isActive, 
  isSpeaking, 
  isListening, 
  isWakeWordActive, 
  isSearching = false,
  isAnalyzing = false,
  orbColor, 
  orbIntensity = 50, 
  isPaused = false, 
  reducedMotion = false 
}: OrbProps) {
  const visualState = useMemo((): OrbVisualState => {
    if (isSpeaking) return "speaking";
    if (isListening) return "listening";
    if (isWakeWordActive) return "alert";
    if (isAnalyzing) return "analyzing";
    if (isSearching) return "searching";
    if (isActive) return "thinking";
    return "idle";
  }, [isActive, isSpeaking, isListening, isWakeWordActive, isSearching, isAnalyzing]);

  const colors = useMemo(() => {
    if (orbColor) {
      return {
        primary: orbColor,
        secondary: STATE_COLORS[visualState].secondary,
        accent: STATE_COLORS[visualState].accent,
      };
    }
    return STATE_COLORS[visualState];
  }, [visualState, orbColor]);

  const glowSize = Math.round(50 + (orbIntensity * 1));
  const glowSize2 = Math.round(100 + (orbIntensity * 1.5));
  
  const breatheDuration = useMemo(() => {
    switch (visualState) {
      case "idle": return 4;
      case "thinking": return 2;
      case "searching": return 1.5;
      case "analyzing": return 1.8;
      case "speaking": return 0.4;
      case "listening": return 0.7;
      case "alert": return 0.3;
      default: return 2;
    }
  }, [visualState]);

  const scaleAnimation = isPaused || reducedMotion
    ? { scale: 1 }
    : { 
        scale: visualState === "speaking" ? [1, 1.15, 1] : 
               visualState === "alert" ? [1, 1.2, 1] : 
               visualState === "listening" ? [1, 1.08, 1] : 
               visualState === "searching" ? [1, 1.1, 1] :
               [1, 1.04, 1] 
      };
  
  return (
    <div className="w-full h-full flex items-center justify-center relative">
      <motion.div
        className="absolute w-44 h-44 md:w-60 md:h-60 rounded-full opacity-20"
        style={{ 
          background: `radial-gradient(circle, ${colors.accent} 0%, transparent 70%)`,
        }}
        animate={{
          scale: isPaused ? 1 : [1, 1.2, 1],
          opacity: isPaused ? 0.2 : [0.2, 0.4, 0.2],
        }}
        transition={{
          duration: breatheDuration * 1.5,
          repeat: isPaused ? 0 : Infinity,
          ease: "easeInOut"
        }}
      />
      
      <motion.div
        className="w-32 h-32 md:w-48 md:h-48 rounded-full relative z-10"
        style={{ 
          background: `radial-gradient(circle at 35% 35%, ${colors.secondary}, ${colors.primary} 70%)`,
        }}
        animate={{
          ...scaleAnimation,
          boxShadow: `0 0 ${glowSize}px ${colors.primary}, 0 0 ${glowSize2}px ${colors.accent}, inset 0 0 50px rgba(255,255,255,0.15)`
        }}
        transition={{
          scale: {
            duration: reducedMotion ? 3 : breatheDuration,
            repeat: isPaused ? 0 : Infinity,
            ease: "easeInOut"
          }
        }}
      />
      
      {(visualState === "searching" || visualState === "alert") && !reducedMotion && !isPaused && (
        <>
          <motion.div
            className="absolute w-36 h-36 md:w-52 md:h-52 rounded-full border-2"
            style={{ borderColor: colors.accent }}
            animate={{
              scale: [1, 1.4, 1],
              opacity: [0.7, 0, 0.7],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: "easeOut"
            }}
          />
          <motion.div
            className="absolute w-36 h-36 md:w-52 md:h-52 rounded-full border"
            style={{ borderColor: colors.secondary }}
            animate={{
              scale: [1, 1.6, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.2
            }}
          />
        </>
      )}
      
      {visualState === "analyzing" && !reducedMotion && !isPaused && (
        <div className="absolute">
          {[0, 1, 2, 3].map((i) => (
            <motion.div
              key={i}
              className="absolute w-3 h-3 rounded-full"
              style={{ 
                backgroundColor: colors.accent,
                boxShadow: `0 0 10px ${colors.accent}`,
              }}
              animate={{
                rotate: 360,
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "linear",
                delay: i * 0.75,
              }}
              initial={{
                x: Math.cos((i / 4) * Math.PI * 2) * 80,
                y: Math.sin((i / 4) * Math.PI * 2) * 80,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface UlysseOrbProps {
  isActive?: boolean;
  isSpeaking?: boolean;
  isListening?: boolean;
  isWakeWordActive?: boolean;
  isSearching?: boolean;
  isAnalyzing?: boolean;
  mood?: ConversationMood;
  className?: string;
  orbColor?: string;
  orbIntensity?: number;
  isPaused?: boolean;
  reducedMotion?: boolean;
}

export function UlysseOrb({ 
  isActive, 
  isSpeaking, 
  isListening, 
  isWakeWordActive, 
  isSearching,
  isAnalyzing,
  mood = "neutral", 
  className, 
  orbColor, 
  orbIntensity = 50, 
  isPaused = false, 
  reducedMotion = false 
}: UlysseOrbProps) {
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isHighEndMobile, setIsHighEndMobile] = useState(false);
  const [useLowPower, setUseLowPower] = useState(false);

  const visualState = useMemo((): OrbVisualState => {
    if (isSpeaking) return "speaking";
    if (isListening) return "listening";
    if (isWakeWordActive) return "alert";
    if (isAnalyzing) return "analyzing";
    if (isSearching) return "searching";
    if (isActive) return "thinking";
    return "idle";
  }, [isActive, isSpeaking, isListening, isWakeWordActive, isSearching, isAnalyzing]);

  const colors = useMemo(() => {
    if (orbColor) {
      return {
        primary: orbColor,
        secondary: STATE_COLORS[visualState].secondary,
        accent: STATE_COLORS[visualState].accent,
      };
    }
    return STATE_COLORS[visualState];
  }, [visualState, orbColor]);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      setWebglAvailable(!!gl);
      
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      setIsMobile(mobile);
      
      const width = window.screen.width;
      const height = window.screen.height;
      const ratio = window.devicePixelRatio;
      const isHighEnd = 
        (width >= 390 && height >= 844 && ratio >= 3) ||
        (width >= 412 && height >= 915 && ratio >= 2.625);
      setIsHighEndMobile(mobile && isHighEnd);
      
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setUseLowPower(prefersReducedMotion || reducedMotion);
    } catch {
      setWebglAvailable(false);
    }
  }, [reducedMotion]);

  const fallback = (
    <FallbackOrb
      isActive={isActive}
      isSpeaking={isSpeaking}
      isListening={isListening}
      isWakeWordActive={isWakeWordActive}
      isSearching={isSearching}
      isAnalyzing={isAnalyzing}
      orbColor={orbColor}
      orbIntensity={orbIntensity}
      isPaused={isPaused}
      reducedMotion={reducedMotion || useLowPower}
    />
  );

  if (!webglAvailable || useLowPower || isPaused) {
    return <div className={cn("bg-black/30", className)}>{fallback}</div>;
  }
  
  return (
    <div className={cn("bg-gradient-to-b from-slate-950/80 to-indigo-950/60", className)}>
      <WebGLErrorBoundary fallback={fallback}>
        <Canvas 
          camera={{ position: [0, 0, 5], fov: 50 }}
          dpr={isHighEndMobile ? [1, 2] : isMobile ? [1, 1.5] : [1, 2]}
          performance={{ min: isHighEndMobile ? 0.6 : 0.5 }}
          frameloop={isPaused ? "demand" : "always"}
          gl={{ 
            antialias: !isMobile || isHighEndMobile,
            powerPreference: isMobile && !isHighEndMobile ? "low-power" : "high-performance",
            alpha: true,
          }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.2} />
            <pointLight position={[8, 8, 8]} intensity={1} color={colors.primary} />
            <pointLight position={[-8, -8, -8]} intensity={0.5} color={colors.secondary} />
            <pointLight position={[0, 8, -8]} intensity={0.3} color={colors.accent} />
            
            <AnimatedOrb 
              isActive={isActive} 
              isSpeaking={isSpeaking} 
              isListening={isListening}
              isWakeWordActive={isWakeWordActive}
              isSearching={isSearching}
              isAnalyzing={isAnalyzing}
              mood={mood}
              orbColor={orbColor}
              orbIntensity={orbIntensity}
              isPaused={isPaused}
              reducedMotion={reducedMotion}
            />
          </Suspense>
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
}
