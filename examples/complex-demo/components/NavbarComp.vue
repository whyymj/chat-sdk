<script setup lang="ts">
/** 导航栏:logo + 标题 + 菜单 */
defineProps<{ logo?: string; title?: string; menu?: { label: string; link?: string }[]; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <nav class="cmp-navbar" :id="id" :style="style" :class="className" v-show="visible !== false">
    <img v-if="logo" :src="logo" class="navbar-logo" alt="logo" />
    <span v-if="title" class="navbar-title">{{ title }}</span>
    <ul class="navbar-menu">
      <li v-for="(item, i) in menu" :key="i"><a :href="item.link || '#'">{{ item.label }}</a></li>
    </ul>
  </nav>
</template>
<style scoped>
.cmp-navbar { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #fff; border-bottom: 1px solid #eee; }
.navbar-logo { height: 32px; }
.navbar-title { font-weight: 700; font-size: 16px; }
.navbar-menu { display: flex; gap: 16px; list-style: none; margin: 0 0 0 auto; padding: 0; }
.navbar-menu a { color: #333; text-decoration: none; font-size: 14px; }
</style>
