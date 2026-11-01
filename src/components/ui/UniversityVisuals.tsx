import React from 'react';

export interface UniversityVisualCardProps {
  variant: 'campus' | 'library' | 'collaboration' | 'faculty';
  kicker: string;
  title: string;
  caption: string;
}

export const UniversityVisualCard: React.FC<UniversityVisualCardProps> = ({
  variant,
  kicker,
  title,
  caption,
}) => {
  return (
    <figure className="rounded-md surface-elevated surface-elevated-interactive overflow-hidden flex flex-col justify-between">
      {/* Architectural & Photographic-Tone SVG Canvas */}
      <div className="relative w-full aspect-16/10 bg-[#292A25] overflow-hidden border-b border-[#292A25]/12">
        {variant === 'campus' && (
          <svg
            viewBox="0 0 640 400"
            className="w-full h-full object-cover"
            role="img"
            aria-label={title}
          >
            <defs>
              <linearGradient id="skyWarm" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#E8E4DC" />
                <stop offset="55%" stopColor="#B5A58D" />
                <stop offset="100%" stopColor="#777B63" />
              </linearGradient>
              <linearGradient id="stoneFacade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F8F7F3" />
                <stop offset="100%" stopColor="#E8E4DC" />
              </linearGradient>
            </defs>
            <rect width="640" height="400" fill="url(#skyWarm)" />
            {/* Distant Academic Quad Lawn */}
            <path d="M0 310 L640 310 L640 400 L0 400 Z" fill="#777B63" />
            <path d="M0 335 L640 315 L640 400 L0 400 Z" fill="#292A25" opacity="0.85" />
            {/* Modern University Academic Pavilion with Colonnade */}
            <polygon points="80,120 560,120 590,150 50,150" fill="#292A25" />
            <rect x="70" y="150" width="500" height="165" fill="url(#stoneFacade)" />
            {/* Architectural Columns & Clerestory Glass */}
            {[105, 175, 245, 315, 385, 455, 525].map((x) => (
              <g key={x}>
                <rect x={x} y="162" width="36" height="135" fill="#292A25" opacity="0.88" />
                <rect x={x + 4} y="166" width="28" height="60" fill="#B5A58D" opacity="0.45" />
                <rect x={x - 8} y="150" width="12" height="165" fill="#E8E4DC" />
              </g>
            ))}
            {/* Plaza Steps */}
            <rect x="45" y="312" width="550" height="8" fill="#F8F7F3" />
            <rect x="30" y="320" width="580" height="8" fill="#B5A58D" />
          </svg>
        )}

        {variant === 'library' && (
          <svg
            viewBox="0 0 640 400"
            className="w-full h-full object-cover"
            role="img"
            aria-label={title}
          >
            <rect width="640" height="400" fill="#292A25" />
            {/* Arched Reading Room Clerestory Windows */}
            {[90, 250, 410].map((x) => (
              <g key={x}>
                <path
                  d={`M${x} 260 L${x} 110 A70 70 0 0 1 ${x + 140} 110 L${x + 140} 260 Z`}
                  fill="#E8E4DC"
                  opacity="0.9"
                />
                <line
                  x1={x + 70}
                  y1="40"
                  x2={x + 70}
                  y2="260"
                  stroke="#292A25"
                  strokeWidth="4"
                />
                <line
                  x1={x}
                  y1="150"
                  x2={x + 140}
                  y2="150"
                  stroke="#292A25"
                  strokeWidth="4"
                />
              </g>
            ))}
            {/* Library Shelving & Policy Archives */}
            <rect x="0" y="260" width="640" height="140" fill="#777B63" />
            <rect x="60" y="285" width="520" height="18" fill="#B5A58D" />
            <rect x="110" y="303" width="420" height="97" fill="#292A25" />
            {/* Reading Lamps */}
            {[170, 320, 470].map((cx) => (
              <g key={cx}>
                <path
                  d={`M${cx - 24} 272 L${cx + 24} 272 L${cx + 14} 254 L${cx - 14} 254 Z`}
                  fill="#F8F7F3"
                />
                <rect x={cx - 2} y="272" width="4" height="13" fill="#292A25" />
              </g>
            ))}
          </svg>
        )}

        {variant === 'collaboration' && (
          <svg
            viewBox="0 0 640 400"
            className="w-full h-full object-cover"
            role="img"
            aria-label={title}
          >
            <rect width="640" height="400" fill="#E8E4DC" />
            {/* Warm Interior Wall Panels */}
            <rect x="40" y="36" width="260" height="220" fill="#F8F7F3" stroke="#B5A58D" strokeWidth="2" />
            <rect x="330" y="36" width="270" height="220" fill="#292A25" />
            {/* Presentation & Policy Flow Diagram on Screen */}
            <rect x="355" y="64" width="95" height="50" rx="4" fill="#777B63" />
            <rect x="475" y="64" width="95" height="50" rx="4" fill="#B5A58D" />
            <rect x="355" y="136" width="215" height="90" rx="4" fill="#F8F7F3" opacity="0.9" />
            {/* Collaborative Seminar Table & Silhouettes */}
            <polygon points="70,295 570,295 615,375 25,375" fill="#B5A58D" />
            <circle cx="205" cy="245" r="24" fill="#292A25" />
            <path d="M165 305 C165 275 245 275 245 305 Z" fill="#292A25" />
            <circle cx="320" cy="238" r="24" fill="#777B63" />
            <path d="M280 298 C280 268 360 268 360 298 Z" fill="#777B63" />
            <circle cx="435" cy="245" r="24" fill="#292A25" />
            <path d="M395 305 C395 275 475 275 475 305 Z" fill="#292A25" />
          </svg>
        )}

        {variant === 'faculty' && (
          <svg
            viewBox="0 0 640 400"
            className="w-full h-full object-cover"
            role="img"
            aria-label={title}
          >
            <rect width="640" height="400" fill="#292A25" />
            <rect x="45" y="40" width="550" height="320" rx="6" fill="#F8F7F3" />
            <rect x="45" y="40" width="180" height="320" fill="#E8E4DC" />
            {/* Architectural Bookcase Grid */}
            {[75, 135, 195, 255].map((y) => (
              <rect key={y} x="65" y={y} width="140" height="42" fill="#B5A58D" opacity="0.65" />
            ))}
            {/* Faculty Governance Review Desk */}
            <rect x="265" y="90" width="290" height="145" rx="4" fill="#292A25" />
            <rect x="285" y="110" width="120" height="16" rx="2" fill="#B5A58D" />
            <rect x="285" y="138" width="240" height="10" rx="2" fill="#E8E4DC" opacity="0.7" />
            <rect x="285" y="158" width="210" height="10" rx="2" fill="#E8E4DC" opacity="0.7" />
            <rect x="285" y="188" width="90" height="24" rx="3" fill="#777B63" />
            <rect x="265" y="265" width="290" height="55" rx="4" fill="#E8E4DC" />
          </svg>
        )}

        {/* Subtle Scrim & Kicker Overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#292A25]/85 via-[#292A25]/35 to-transparent px-5 py-3.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-[#E8E4DC] tracking-wide">
            {kicker}
          </span>
          <span className="font-mono-tabular text-[11px] text-[#B5A58D]">
            UNIVERSITY ENVIRONMENT
          </span>
        </div>
      </div>

      {/* Caption Block */}
      <figcaption className="p-5 bg-[#F8F7F3] flex flex-col gap-1.5">
        <h3 className="text-base font-serif-display text-[#292A25]">{title}</h3>
        <p className="text-xs text-[#292A25]/75 leading-relaxed">{caption}</p>
      </figcaption>
    </figure>
  );
};
