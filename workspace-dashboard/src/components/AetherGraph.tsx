import { useRef, useMemo, useEffect } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import type { GraphData, NodeData } from '../types';
import * as THREE from 'three';

interface Props {
  onNodeClick: (node: NodeData | null) => void;
  graphData: GraphData;
  focusedNodeId?: string | null;
}

const AetherGraph: React.FC<Props> = ({ onNodeClick, graphData, focusedNodeId }) => {
  const fgRef = useRef<ForceGraphMethods>(null!);

  // Post-processing and bloom-like material
  const nodeMaterial = useMemo(() => {
    return new THREE.MeshPhongMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.9,
      emissive: 0x00f0ff,
      emissiveIntensity: 0.5,
    });
  }, []);
  
  const focusMaterial = useMemo(() => {
    return new THREE.MeshPhongMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      emissive: 0x00f0ff,
      emissiveIntensity: 2.0,
    });
  }, []);

  useEffect(() => {
    if (focusedNodeId && fgRef.current) {
        const node = graphData.nodes.find(n => n.id === focusedNodeId);
        if (node) {
            // Camera follow
            const distance = 80;
            const distRatio = 1 + distance / Math.hypot((node as any).x, (node as any).y, (node as any).z);
            fgRef.current.cameraPosition(
                { x: (node as any).x * distRatio, y: (node as any).y * distRatio, z: (node as any).z * distRatio },
                node as any,
                2000
            );
        }
    }
  }, [focusedNodeId, graphData]);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      nodeLabel="label"
      nodeColor={(node: any) => {
        if (node.type === 'tag') return '#a855f7';
        if (node.type === 'symbol') return '#22d3ee'; // Cyan
        if (node.type === 'entity') return '#94a3b8'; // Slate
        return '#00f0ff';
      }}
      linkColor={(link: any) => {
        if (link.type === 'code-ref') return 'rgba(34, 211, 238, 0.6)';
        if (link.type === 'contains') return 'rgba(148, 163, 184, 0.3)';
        return 'rgba(0, 240, 255, 0.2)';
      }}
      linkWidth={(link: any) => link.type === 'code-ref' ? 2 : 1.5}
      nodeVal={(node: any) => node.val || 5}
      onNodeClick={(node: any) => onNodeClick(node as NodeData)}
      onBackgroundClick={() => onNodeClick(null)}
      showNavInfo={false}
      enableNodeDrag={false}
      nodeThreeObject={(node: any) => {
        let geometry;
        if (node.type === 'tag') {
          geometry = new THREE.OctahedronGeometry(Math.sqrt(node.val || 5) * 2);
        } else if (node.type === 'symbol') {
          geometry = new THREE.IcosahedronGeometry(Math.sqrt(node.val || 5) * 1.2);
        } else {
          geometry = new THREE.SphereGeometry(Math.sqrt(node.val || 5) * 1.5);
        }
           
        const mesh = new THREE.Mesh(geometry, nodeMaterial.clone());
        const status = node.metadata?.intelligenceStatus;

        if (node.type === 'tag') {
          mesh.material.color.set(0xa855f7);
        } else if (node.type === 'symbol') {
          mesh.material.color.set(0x22d3ee);
        } else if (node.type === 'entity') {
          mesh.material.color.set(0x94a3b8);
        } else if (status === 'processing') {
          mesh.material.color.set(0xfacc15); // Yellow Pulse
          mesh.material.emissive.set(0xfacc15);
          mesh.material.emissiveIntensity = 1.0;
        } else if (status === 'ready') {
          mesh.material.color.set(0x34d399); // Green (Complete)
        } else {
          mesh.material.color.set(0x00f0ff); // Pending
        }

        // 🟢 NEXUS UPGRADE: Heat Scaling
        const heat = node.metadata?.heat || 0;
        const heatMultiplier = 1 + Math.min(heat * 0.2, 1.5);
        mesh.scale.set(heatMultiplier, heatMultiplier, heatMultiplier);
        
        if (heat > 0) {
            mesh.material.emissiveIntensity = 0.5 + (heat * 0.5);
        }

        // 🔒 NEXUS UPGRADE: Locking Status
        if (node.metadata?.lock) {
            mesh.material.color.set(0xef4444); // Red (Locked)
            mesh.material.emissive.set(0xef4444);
            mesh.material.emissiveIntensity = 2.0;
        }

        if (node.id === focusedNodeId) {
            mesh.material = focusMaterial;
            mesh.scale.set(1.5, 1.5, 1.5);
        }

        return mesh;
      }}
      cooldownTicks={100}
    />
  );
};

export default AetherGraph;
