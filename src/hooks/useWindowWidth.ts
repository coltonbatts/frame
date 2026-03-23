import { useEffect, useState } from 'react';

export function useWindowWidth(): number {
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return windowWidth;
}
