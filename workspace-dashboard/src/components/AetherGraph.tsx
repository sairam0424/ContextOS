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
            const distance = 100;
            const distRatio = 1 + distance / Math.hypot((node as any).x, (node as any).y, (node as any).z);
            fgRef.current.cameraPosition(
                { x: (node as any).x * distRatio, y: (node as any).y * distRatio, z: (node as any).z * distRatio },
                node as any,
                2000
            );
        }
    }
  }, [focusedNodeId, graphData]);

  // Aether 2.0: Planet & Moon Clustering Force
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('cluster', (alpha: number) => {
        graphData.nodes.forEach((node: any) => {
          if (node.type !== 'bucket' && node.metadata?.bucketId) {
            const bucketNode = graphData.nodes.find(n => n.id === node.metadata.bucketId);
            if (bucketNode && (bucketNode as any).x !== undefined) {
              const b = bucketNode as any;
              node.vx += (b.x - node.x) * alpha * 0.15;
              node.vy += (b.y - node.y) * alpha * 0.15;
              node.vz += (b.z - node.z) * alpha * 0.15;
            }
          }
        });
      });
      // Strengthen link force for local proximity
      fgRef.current.d3Force('link')?.distance(30);
    }
  }, [graphData]);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      nodeLabel={(node: any) => {
        let label = `<div class="aether-node-label">
          <strong>${node.label || node.id}</strong><br/>
          <small>${node.type}</small>`;
        
        if (node.metadata?.actions && node.metadata.actions.length > 0) {
          label += `<div class="aether-actions">
            ${node.metadata.actions.map((a: string) => `<span>[${a}]</span>`).join(' ')}
          </div>`;
        }
        
        label += `</div>`;
        return label;
      }}
      nodeColor={(node: any) => {
        if (node.type === 'tag') return '#a855f7';
        if (node.type === 'symbol') return '#22d3ee'; // Cyan
        if (node.type === 'entity') return '#94a3b8'; // Slate
        if (node.type === 'mission') return '#f97316'; // Orange
        if (node.type === 'bucket') return '#ec4899'; // Pink (Planetary center)
        if (node.metadata?.is_private) return 'rgba(100, 116, 139, 0.4)'; // Ghostly
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
        } else if (node.type === 'mission') {
          geometry = new THREE.DodecahedronGeometry(Math.sqrt(node.val || 5) * 2.5);
        } else if (node.type === 'bucket') {
          geometry = new THREE.SphereGeometry(Math.sqrt(node.val || 50) * 3);
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
        } else if (status === 'processing' || status === 'repairing') {
          mesh.material.color.set(0xfacc15); // Yellow Pulse (Processing or Repairing)
          mesh.material.emissive.set(0xfacc15);
          mesh.material.emissiveIntensity = status === 'repairing' ? 2.0 : 1.0;
        } else if (status === 'ready') {
          mesh.material.color.set(0x34d399); // Green (Complete)
        } else if (status === 'error') {
          mesh.material.color.set(0xef4444); // Red (Error/Blocked)
          mesh.material.emissive.set(0xef4444);
          mesh.material.emissiveIntensity = 1.0;
        } else if (node.type === 'mission') {
          mesh.material.color.set(0xf97316); // Mission Orange
          mesh.material.emissive.set(0xf97316);
          mesh.material.emissiveIntensity = 0.8;
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
        if (node.metadata?.lock || status === 'error') {
            mesh.material.color.set(0xef4444); // Red (Locked or Error)
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
