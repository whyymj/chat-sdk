<script setup lang="ts">
/**
 * 轮播组件 —— 自动播放 + 手动切换(纯 CSS/JS,无三方依赖)
 * autoplay=true 时按 interval(ms)自动切换;点击指示器手动切换
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import CompWrapper from './CompWrapper.vue'

const props = defineProps<{
  autoplay?: boolean
  interval?: number
  slides: { image: string; caption?: string }[]
  id?: string
  style?: Record<string, string>
  visible?: boolean
  className?: string
}>()

const current = ref(0)
let timer: number | undefined

function go(i: number) { current.value = (i + props.slides.length) % props.slides.length }
function next() { go(current.value + 1) }

function start() {
  stop()
  if (props.autoplay && props.slides.length > 1) timer = window.setInterval(next, props.interval ?? 3000)
}
function stop() { if (timer) { clearInterval(timer); timer = undefined } }

onMounted(start)
onUnmounted(stop)
watch(() => [props.autoplay, props.interval, props.slides.length], start)
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div class="c-carousel" @mouseenter="stop" @mouseleave="start">
      <div class="c-carousel__track" :style="{ transform: `translateX(-${current * 100}%)` }">
        <div v-for="(s, i) in slides" :key="i" class="c-carousel__slide">
          <img :src="s.image" :alt="s.caption || ''" class="c-carousel__img" />
          <span v-if="s.caption" class="c-carousel__caption">{{ s.caption }}</span>
        </div>
      </div>
      <div class="c-carousel__dots">
        <button
          v-for="(_, i) in slides"
          :key="i"
          class="c-carousel__dot"
          :class="{ active: i === current }"
          @click="go(i)"
        ></button>
      </div>
    </div>
  </CompWrapper>
</template>

<style scoped>
.c-carousel { position: relative; overflow: hidden; border-radius: 10px; background: #f3f4f6; }
.c-carousel__track { display: flex; transition: transform 0.4s ease; }
.c-carousel__slide { position: relative; flex: 0 0 100%; }
.c-carousel__img { width: 100%; height: 300px; object-fit: cover; display: block; }
.c-carousel__caption { position: absolute; bottom: 12px; left: 12px; background: rgba(0,0,0,0.55); color: #fff; padding: 4px 12px; border-radius: 6px; font-size: 13px; }
.c-carousel__dots { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; }
.c-carousel__dot { width: 8px; height: 8px; border-radius: 50%; border: none; background: rgba(255,255,255,0.5); cursor: pointer; padding: 0; }
.c-carousel__dot.active { background: #fff; }
</style>
