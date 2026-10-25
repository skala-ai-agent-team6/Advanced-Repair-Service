<script setup lang="ts">
/* 기술 자료 (기사 메뉴) — 아직 데이터가 없어 준비 중 */
import StateView from '@/components/common/StateView.vue'
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>기술 자료</h1>
        <p class="sub">서비스 매뉴얼 · 에러 코드 정의서 · 기술 공지</p>
      </div>
    </div>
    <StateView state="empty" title="기술 자료는 준비 중이에요" message="자료가 등록되면 이곳에서 볼 수 있어요." class="card" />
  </div>
</template>
