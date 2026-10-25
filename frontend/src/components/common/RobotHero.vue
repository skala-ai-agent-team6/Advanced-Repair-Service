<script setup lang="ts">
// 로그인 화면 왼쪽(기존 1~5단계 안내 자리)에 들어가는 로봇청소기 애니메이션
// 이미지: public/images/robot/robot-2.webp (이동), robot-4.webp (모션 줄이기 설정 시 정지 이미지)
const base = import.meta.env.BASE_URL
</script>

<template>
  <div class="robot-hero" aria-hidden="true">
    <div class="floor-glow" />
    <div class="track">
      <img class="robot moving" :src="`${base}images/robot/robot-2.webp`" alt="" draggable="false" />
    </div>
    <img class="robot still" :src="`${base}images/robot/robot-4.webp`" alt="" draggable="false" />
  </div>
</template>

<style scoped>
.robot-hero {
  position: relative;
  width: 100%;
  max-width: 520px;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  /* 양옆 가장자리를 부드럽게 흐리기 */
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent);
}

/* 바닥의 은은한 파란 빛 */
.floor-glow {
  position: absolute;
  left: 10%;
  right: 10%;
  bottom: 12%;
  height: 28%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(59, 130, 246, 0.28), rgba(59, 130, 246, 0));
  filter: blur(8px);
  animation: glow 6s ease-in-out infinite;
}

/* 왼쪽에서 들어와 오른쪽으로 지나가고, 사라졌다가 다시 시작 */
.track {
  position: absolute;
  inset: 0;
  animation: drive 6s cubic-bezier(0.45, 0, 0.25, 1) infinite;
}

.robot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 120%;
  translate: -50% -50%;
}

/* 주행 중 살짝 위아래로 흔들림 */
.moving {
  animation: bob 0.9s ease-in-out infinite;
}

.still {
  display: none;
}

@keyframes drive {
  0%   { transform: translateX(-55%); opacity: 0; }
  12%  { opacity: 1; }
  50%  { transform: translateX(0); }
  88%  { opacity: 1; }
  100% { transform: translateX(55%); opacity: 0; }
}

@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1.5%); }
}

@keyframes glow {
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 1; }
}

/* 움직임 줄이기 설정을 켠 사용자에게는 정지 이미지 */
@media (prefers-reduced-motion: reduce) {
  .track, .floor-glow { animation: none; }
  .track { display: none; }
  .still { display: block; }
}
</style>
