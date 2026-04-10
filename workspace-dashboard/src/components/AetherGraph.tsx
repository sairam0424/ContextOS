import { useRef, useEffect, useState, useMemo } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import type { GraphData, NodeData } from '../types';
import * as THREE from 'three';

interface Props {
  onNodeClick: (node: NodeData | null) => void;
}

const AetherGraph: React.FC<Props> = ({ onNodeClick }) => {
  const fgRef = useRef<ForceGraphMethods>(null!);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const res = await fetch('http://localhost:3010/api/graph');
        const data = await res.json();
        setGraphData(data);
      } catch (err) {
        console.error("Graph fetch failed", err);
      }
    };

    fetchGraph();
    const interval = setInterval(fetchGraph, 10000);
    return () => clearInterval(interval);
  }, []);

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

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      nodeLabel="label"
      nodeColor={(node: any) => node.type === 'tag' ? '#a855f7' : '#00f0ff'}
      linkColor={() => 'rgba(0, 240, 255, 0.2)'}
      linkWidth={1.5}
      nodeVal={(node: any) => node.val || 5}
      onNodeClick={(node: any) => onNodeClick(node as NodeData)}
      onBackgroundClick={() => onNodeClick(null)}
      showNavInfo={false}
      enableNodeDrag={false}
      nodeThreeObject={(node: any) => {
        const geometry = node.type === 'tag' 
           ? new THREE.OctahedronGeometry(Math.sqrt(node.val || 5) * 2)
           : new THREE.SphereGeometry(Math.sqrt(node.val || 5) * 1.5);
           
        const mesh = new THREE.Mesh(geometry, nodeMaterial.clone());
        if (node.type === 'tag') mesh.material.color.set(0xa855f7);
        return mesh;
      }}
      cooldownTicks={100}
    />
  );
};

export default AetherGraph;
