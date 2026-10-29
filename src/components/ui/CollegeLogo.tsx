import React, { useState } from 'react';

export interface CollegeLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showFallbackOnFail?: boolean;
}

const sizeClasses: Record<NonNullable<CollegeLogoProps['size']>, string> = {
  xs: 'w-6 h-6',
  sm: 'w-9 h-9',
  md: 'w-11 h-11',
  lg: 'w-16 h-16',
  xl: 'w-20 h-20',
};

/**
 * Institutional College Logo Component for KAMCH ERP.
 * Strictly respects aspect ratio and colors with object-fit: contain.
 * Loads offline from local asset: /assets/kamch-logo.png (or SVG vector fallback).
 */
export const CollegeLogo: React.FC<CollegeLogoProps> = ({
  size = 'md',
  className = '',
}) => {
  // Try PNG first, fall back to local SVG asset
  const [imgSrc, setImgSrc] = useState<string>('/assets/kamch-logo.png');
  const [hasError, setHasError] = useState(false);

  const handleImageError = () => {
    if (imgSrc === '/assets/kamch-logo.png') {
      // Fallback to local vector SVG asset
      setImgSrc('/assets/kamch-logo.svg');
    } else {
      setHasError(true);
    }
  };

  const containerSizeClass = sizeClasses[size];

  if (hasError) {
    // Graceful high-contrast institutional emblem if both assets are somehow missing
    return (
      <div
        className={`${containerSizeClass} rounded-md bg-[#4B2E2E] border border-[#D4AF37]/60 flex items-center justify-center shrink-0 shadow-xs ${className}`}
        title="Krishna Ayurvedic Medical College and Hospital"
        aria-label="KAMCH College Logo"
      >
        <span className="font-serif font-bold text-[#D4AF37] text-xs tracking-wider">
          KAMCH
        </span>
      </div>
    );
  }

  return (
    <div
      className={`${containerSizeClass} flex items-center justify-center shrink-0 ${className}`}
    >
      <img
        src={imgSrc}
        alt="Krishna Ayurvedic Medical College & Hospital Logo"
        onError={handleImageError}
        className="w-full h-full object-contain drop-shadow-xs"
        loading="eager"
      />
    </div>
  );
};
