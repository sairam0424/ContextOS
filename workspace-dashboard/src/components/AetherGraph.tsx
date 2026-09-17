import { useRef, useMemo, useEffect } from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
} from "react-force-graph-3d";
import type { GraphData, NodeData, EdgeData } from "../types";
import * as THREE from "three";

// LOD threshold: switch to simplified rendering above this node count
const LOD_THRESHOLD = 150;
// Camera distance beyond which non-focused nodes use BasicMaterial (cheaper)
const LOD_DISTANCE = 200;

// react-force-graph-3d mutates nodes/links in place once the simulation
// starts, adding position/velocity fields (x/y/z/vx/vy/vz) to nodes and
// resolving link source/target from string IDs to the actual node object.
// These aliases describe that post-mutation runtime shape, which is what
// every ForceGraph3D callback below actually receives.
type FgNode = NodeObject<NodeData>;
// Omit source/target from EdgeData: it declares them as plain `string`,
// which would intersect down to just `string` and make the library's own
// broader `source?: string | number | NodeObject<NodeData>` unreachable.
type FgLink = LinkObject<NodeData, Omit<EdgeData, "source" | "target">>;

interface Props {
  onNodeClick: (node: NodeData | null) => void;
  onNodeRightClick?: (node: NodeData, x: number, y: number) => void;
  graphData: GraphData;
  focusedNodeId?: string | null;
}

const AetherGraph: React.FC<Props> = ({
  onNodeClick,
  onNodeRightClick,
  graphData,
  focusedNodeId,
}) => {
  const fgRef = useRef<ForceGraphMethods<FgNode, FgLink>>(null!);
  const isLargeGraph = graphData.nodes.length > LOD_THRESHOLD;

  const nodeMaterial = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.9,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.5,
      }),
    [],
  );

  const lodMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.6,
      }),
    [],
  );

  const focusMaterial = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        emissive: 0x00f0ff,
        emissiveIntensity: 2.0,
      }),
    [],
  );

  useEffect(() => {
    if (focusedNodeId && fgRef.current) {
      const node = graphData.nodes.find((n) => n.id === focusedNodeId) as
        FgNode | undefined;
      if (node) {
        const distance = 100;
        const distRatio =
          1 + distance / Math.hypot(node.x ?? 1, node.y ?? 1, node.z ?? 1);
        fgRef.current.cameraPosition(
          {
            x: (node.x ?? 0) * distRatio,
            y: (node.y ?? 0) * distRatio,
            z: (node.z ?? 0) * distRatio,
          },
          { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
          2000,
        );
      }
    }
  }, [focusedNodeId, graphData]);

  // Aether 2.0: Planet & Moon Clustering Force
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force("cluster", (alpha: number) => {
        (graphData.nodes as FgNode[]).forEach((node) => {
          if (node.type !== "bucket" && node.metadata?.bucketId) {
            const bucketNode = graphData.nodes.find(
              (n) => n.id === node.metadata?.bucketId,
            ) as FgNode | undefined;
            if (bucketNode && bucketNode.x !== undefined) {
              const b = bucketNode;
              node.vx =
                (node.vx ?? 0) + ((b.x ?? 0) - (node.x ?? 0)) * alpha * 0.15;
              node.vy =
                (node.vy ?? 0) + ((b.y ?? 0) - (node.y ?? 0)) * alpha * 0.15;
              node.vz =
                (node.vz ?? 0) + ((b.z ?? 0) - (node.z ?? 0)) * alpha * 0.15;
            }
          }
        });
      });
      fgRef.current.d3Force("link")?.distance(30);
    }
  }, [graphData]);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      // LOD: hide low-heat isolated nodes when graph is large
      nodeVisibility={(node: FgNode) => {
        if (!isLargeGraph) return true;
        const heat = node.metadata?.heat ?? 0;
        const val = node.val ?? 5;
        return heat > 0 || val >= 2 || node.id === focusedNodeId;
      }}
      // Edge culling: only render edges with meaningful weight
      linkVisibility={(link: FgLink) => (link.weight ?? 1) >= 0.2}
      nodeLabel={(node: FgNode) => {
        let label = `<div class="aether-node-label"><strong>${node.label || node.id}</strong><br/><small>${node.type}</small>`;
        if (node.metadata?.actions && node.metadata.actions.length > 0) {
          label += `<div class="aether-actions">${node.metadata.actions.map((a: string) => `<span>[${a}]</span>`).join(" ")}</div>`;
        }
        return label + `</div>`;
      }}
      nodeColor={(node: FgNode) => {
        if (node.type === "tag") return "#a855f7";
        if (node.type === "symbol") return "#22d3ee";
        if (node.type === "entity") return "#94a3b8";
        if (node.type === "mission") return "#f97316";
        if (node.type === "bucket") return "#ec4899";
        if (node.metadata?.is_private) return "rgba(100, 116, 139, 0.4)";
        return "#00f0ff";
      }}
      linkColor={(link: FgLink) => {
        if (link.type === "code-ref") return "rgba(34, 211, 238, 0.6)";
        if (link.type === "contains") return "rgba(148, 163, 184, 0.3)";
        return "rgba(0, 240, 255, 0.2)";
      }}
      linkWidth={(link: FgLink) => (link.type === "code-ref" ? 2 : 1.5)}
      nodeVal={(node: FgNode) => node.val || 5}
      onNodeClick={(node: FgNode) => onNodeClick(node)}
      onNodeRightClick={(node: FgNode, event: MouseEvent) =>
        onNodeRightClick?.(node, event.clientX, event.clientY)
      }
      onBackgroundClick={() => onNodeClick(null)}
      showNavInfo={false}
      enableNodeDrag={false}
      nodeThreeObject={(node: FgNode) => {
        const val = node.val || 5;
        let geometry: THREE.BufferGeometry;
        if (node.type === "tag") {
          geometry = new THREE.OctahedronGeometry(Math.sqrt(val) * 2);
        } else if (node.type === "symbol") {
          geometry = new THREE.IcosahedronGeometry(Math.sqrt(val) * 1.2);
        } else if (node.type === "mission") {
          geometry = new THREE.DodecahedronGeometry(Math.sqrt(val) * 2.5);
        } else if (node.type === "bucket") {
          geometry = new THREE.SphereGeometry(Math.sqrt(val) * 3);
        } else {
          geometry = new THREE.SphereGeometry(Math.sqrt(val) * 1.5);
        }

        // LOD: use cheaper BasicMaterial for distant non-focused nodes in large graphs
        const camera = fgRef.current?.camera?.();
        const nodePos = new THREE.Vector3(
          node.x ?? 0,
          node.y ?? 0,
          node.z ?? 0,
        );
        const camDist = camera ? camera.position.distanceTo(nodePos) : 0;
        const useLOD =
          isLargeGraph && camDist > LOD_DISTANCE && node.id !== focusedNodeId;

        const baseMat = useLOD ? lodMaterial.clone() : nodeMaterial.clone();
        const mesh = new THREE.Mesh(geometry, baseMat);

        if (!useLOD) {
          const status = node.metadata?.intelligenceStatus;
          if (node.type === "tag") mesh.material.color.set(0xa855f7);
          else if (node.type === "symbol") mesh.material.color.set(0x22d3ee);
          else if (node.type === "entity") mesh.material.color.set(0x94a3b8);
          else if (status === "processing" || status === "repairing") {
            mesh.material.color.set(0xfacc15);
            (mesh.material as THREE.MeshPhongMaterial).emissive?.set(0xfacc15);
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity =
              status === "repairing" ? 2.0 : 1.0;
          } else if (status === "ready") {
            mesh.material.color.set(0x34d399);
          } else if (status === "error" || status === "failed") {
            mesh.material.color.set(0xef4444);
            (mesh.material as THREE.MeshPhongMaterial).emissive?.set(0xef4444);
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 1.0;
          } else if (node.type === "mission") {
            mesh.material.color.set(0xf97316);
            (mesh.material as THREE.MeshPhongMaterial).emissive?.set(0xf97316);
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.8;
          } else {
            mesh.material.color.set(0x00f0ff);
          }

          const heat = node.metadata?.heat || 0;
          const heatMultiplier = 1 + Math.min(heat * 0.2, 1.5);
          mesh.scale.set(heatMultiplier, heatMultiplier, heatMultiplier);
          if (heat > 0)
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity =
              0.5 + heat * 0.5;

          if (node.metadata?.lock) {
            mesh.material.color.set(0xef4444);
            (mesh.material as THREE.MeshPhongMaterial).emissive?.set(0xef4444);
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 2.0;
          }
        }

        if (node.id === focusedNodeId) {
          mesh.material = focusMaterial;
          mesh.scale.set(1.5, 1.5, 1.5);
        }

        return mesh;
      }}
      // Reduce physics simulation ticks for large graphs to save CPU
      cooldownTicks={isLargeGraph ? 50 : 100}
    />
  );
};

export default AetherGraph;
