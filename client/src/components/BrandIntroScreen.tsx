import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Volume2, VolumeX, SkipForward } from 'lucide-react';

interface BrandIntroScreenProps {
  onComplete: () => void;
  autoPlay?: boolean;
}

export const BrandIntroScreen: React.FC<BrandIntroScreenProps> = ({
  onComplete,
  autoPlay = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  const handleFinish = useCallback(() => {
    if (isFadingOut) return;
    setIsFadingOut(true);
    setTimeout(() => {
      onComplete();
    }, 400); // 400ms smooth fade out transition
  }, [isFadingOut, onComplete]);

  // Attempt autoplay on mount
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let mounted = true;

    const startPlayback = async () => {
      try {
        // Try unmuted autoplay first
        video.muted = false;
        await video.play();
        if (mounted) {
          setIsMuted(false);
          setAutoplayBlocked(false);
          setHasStarted(true);
        }
      } catch {
        // Unmuted autoplay blocked by browser policy; fall back to muted autoplay
        try {
          video.muted = true;
          await video.play();
          if (mounted) {
            setIsMuted(true);
            setAutoplayBlocked(false);
            setHasStarted(true);
          }
        } catch {
          // Autoplay fully blocked by browser; present explicit "Play Intro" gesture button
          if (mounted) {
            setAutoplayBlocked(true);
            setHasStarted(false);
          }
        }
      }
    };

    if (autoPlay) {
      startPlayback();
    }

    // Safety fallback: if video stalls or ended event doesn't fire, transition cleanly after 9 seconds
    const safetyTimer = setTimeout(() => {
      if (mounted) {
        handleFinish();
      }
    }, 9500);

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
    };
  }, [autoPlay, handleFinish]);

  // Keyboard accessibility: Escape or Enter to skip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        handleFinish();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFinish]);

  // Update progress bar
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    setProgress((video.currentTime / video.duration) * 100);
  };

  const handlePlayClick = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.muted = false;
      await video.play();
      setIsMuted(false);
      setAutoplayBlocked(false);
      setHasStarted(true);
    } catch {
      // Fallback to muted if unmuted still rejected
      video.muted = true;
      await video.play();
      setIsMuted(true);
      setAutoplayBlocked(false);
      setHasStarted(true);
    }
  };

  const toggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-[#070D18] flex flex-col items-center justify-center transition-opacity duration-400 ease-out select-none ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      aria-label="KMACCS Brand Introduction"
    >
      {/* Background ambient lighting */}
      <div className="absolute inset-0 bg-radial-gradient from-blue-900/15 via-transparent to-transparent pointer-events-none" />

      {/* Main Video Presentation Container */}
      <div className="relative w-full h-full flex items-center justify-center">
        <video
          ref={videoRef}
          src="/kmaccs-intro.mp4"
          className="w-full h-full object-contain pointer-events-none"
          playsInline
          preload="auto"
          onEnded={handleFinish}
          onTimeUpdate={handleTimeUpdate}
          onError={() => {
            handleFinish();
          }}
        />

        {/* Autoplay Blocked State — Play Intro Option */}
        {autoplayBlocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xs z-20">
            <div className="flex flex-col items-center gap-6 p-8 max-w-md text-center">
              <button
                type="button"
                onClick={handlePlayClick}
                className="group relative flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-tr from-[#0B357A] to-[#059669] text-white shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer ring-4 ring-white/20 hover:ring-white/40"
                aria-label="Play Brand Intro"
              >
                <Play className="w-8 h-8 fill-white translate-x-0.5" />
                <span className="absolute -bottom-8 whitespace-nowrap text-xs font-medium tracking-wider text-slate-300 uppercase">
                  Play Intro
                </span>
              </button>

              <div className="mt-8">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="text-xs text-slate-400 hover:text-white underline underline-offset-4 transition-colors cursor-pointer"
                >
                  Skip to Login
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Top Control Bar: Audio Toggle & Skip Intro */}
        <div className="absolute top-6 right-6 z-30 flex items-center gap-3">
          {hasStarted && (
            <button
              type="button"
              onClick={toggleSound}
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-xs font-medium backdrop-blur-md border border-white/15 transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
              aria-label={isMuted ? 'Unmute video' : 'Mute video'}
            >
              {isMuted ? (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-amber-300" />
                  <span>Unmute</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Sound On</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleFinish}
            className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/25 active:bg-white/30 text-white text-xs font-medium tracking-wide backdrop-blur-md border border-white/20 transition-all flex items-center gap-1.5 shadow-md cursor-pointer hover:border-white/30"
          >
            <span>Skip Intro</span>
            <SkipForward className="w-3 h-3 text-slate-300" />
          </button>
        </div>

        {/* Bottom Progress Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-30">
          <div
            className="h-full bg-gradient-to-r from-[#0B357A] via-[#059669] to-emerald-400 transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};
