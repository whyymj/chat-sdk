<script setup lang="ts">
/** 页脚:链接 + 版权 + 联系 */
defineProps<{ links?: { label: string; link?: string }[]; copyright?: string; contact?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <footer class="cmp-footer" :id="id" :style="style" :class="className" v-show="visible !== false">
    <ul v-if="links?.length" class="footer-links">
      <li v-for="(l, i) in links" :key="i"><a :href="l.link || '#'">{{ l.label }}</a></li>
    </ul>
    <div v-if="contact" class="footer-contact">{{ contact }}</div>
    <div v-if="copyright" class="footer-copyright">{{ copyright }}</div>
  </footer>
</template>
<style scoped>
.cmp-footer { padding: 20px 16px; background: #1f2937; color: #ccc; text-align: center; font-size: 13px; }
.footer-links { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; list-style: none; padding: 0; margin: 0 0 8px; }
.footer-links a { color: #ccc; text-decoration: none; }
.footer-contact { margin-bottom: 4px; }
.footer-copyright { color: #888; font-size: 12px; }
</style>
