import React from 'react';
import Image from 'next/image';

interface ConcatenatedLogoProps {
  width?: number;
  height?: number;
  className?: string;
}

export function ConcatenatedLogo({ width = 400, height = 80, className = "" }: ConcatenatedLogoProps) {
  return (
    <div 
      className={`flex items-center gap-4 ${className}`}
      style={{ width: width, height: height }}
    >
      {/* L&G Logo - Original (now first) */}
      <div className="flex-shrink-0">
        <Image
          src="/images/L&G_Logo.png"
          alt="L&G Investment Management"
          width={Math.floor(width * 0.4)}
          height={height}
          className="object-contain"
          priority
        />
      </div>
      
      {/* Kyndryl Logo - Original (now second) */}
      <div className="flex-shrink-0">
        <Image
          src="/images/kyndryl-logo.svg"
          alt="Kyndryl"
          width={Math.floor(width * 0.5)}
          height={height}
          className="object-contain"
          priority
        />
      </div>
    </div>
  );
}

export default ConcatenatedLogo;
