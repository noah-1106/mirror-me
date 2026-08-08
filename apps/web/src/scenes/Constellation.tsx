import { motion } from 'framer-motion';
import { useMemo } from 'react';
import type { ChoiceRecord } from '@oasis/shared';

interface Node {
  id: number;
  x: number;
  y: number;
  self: boolean;
  label: string;
}

export function Constellation({ history }: { history: ChoiceRecord[] }) {
  const { nodes, links, selfCount } = useMemo(() => {
    const count = history.length;
    const radius = 180;
    const centerX = 0;
    const centerY = 0;

    const nodes: Node[] = history.map((record, i) => {
      const angle = (i / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        id: i,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        self: record.selfReferential,
        label: record.choiceText,
      };
    });

    const links: Array<{ from: Node; to: Node }> = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      links.push({ from: nodes[i], to: nodes[i + 1] });
    }

    return {
      nodes,
      links,
      selfCount: nodes.filter((n) => n.self).length,
    };
  }, [history]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#050505]">
      <svg width="100%" height="100%" viewBox="-300 -250 600 500" className="max-h-screen">
        <defs>
          <g id="star">
            <circle r="6" />
          </g>
        </defs>

        {links.map((link, i) => (
          <motion.line
            key={i}
            x1={link.from.x}
            y1={link.from.y}
            x2={link.to.x}
            y2={link.to.y}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, delay: i * 0.3 }}
          />
        ))}

        {nodes.map((node, i) => (
          <g key={node.id}>
            <motion.circle
              cx={node.x}
              cy={node.y}
              r={10}
              fill={node.self ? '#f59e0b' : '#3b82f6'}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: i * 0.2 }}
              filter="url(#glow)"
            />
            <text
              x={node.x}
              y={node.y + 28}
              textAnchor="middle"
              fill="rgba(255,255,255,0.7)"
              fontSize={12}
            >
              {node.label}
            </text>
          </g>
        ))}

        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </svg>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-20 text-center"
      >
        <p className="mb-2 text-lg text-white/80">
          这些选择里，有{' '}
          <span className="text-amber-400 font-semibold">{selfCount}</span> 颗是你自己点亮的。
        </p>
        <p className="text-sm text-white/50">"这是现在的你正在成为的样子。你变了，它也会变。"</p>
      </motion.div>
    </div>
  );
}
