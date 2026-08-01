<script setup lang="ts">
/** 优惠券:面额 + 门槛 + 状态 */
defineProps<{ amount: number; threshold?: number; label?: string; status?: 'available' | 'claimed' | 'used' | 'expired'; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-coupon" :class="[status, className]" :id="id" :style="style" v-show="visible !== false">
    <div class="coupon-amount"><small>¥</small>{{ amount }}</div>
    <div class="coupon-meta">
      <div v-if="label" class="coupon-label">{{ label }}</div>
      <div class="coupon-threshold">{{ threshold ? `满 ${threshold} 元可用` : '无门槛' }}</div>
      <div class="coupon-status">{{ { available: '立即领取', claimed: '已领取', used: '已使用', expired: '已过期' }[status || 'available'] }}</div>
    </div>
  </div>
</template>
<style scoped>
.cmp-coupon { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: linear-gradient(90deg, #fff5f5, #fff); border: 1px dashed #e11d48; border-radius: 8px; }
.coupon-amount { color: #e11d48; font-size: 28px; font-weight: 800; }
.coupon-amount small { font-size: 14px; }
.coupon-meta { flex: 1; }
.coupon-label { font-weight: 600; font-size: 14px; }
.coupon-threshold { color: #888; font-size: 12px; }
.coupon-status { color: #e11d48; font-size: 13px; margin-top: 4px; }
.cmp-coupon.claimed { opacity: .6; }
.cmp-coupon.used, .cmp-coupon.expired { filter: grayscale(1); opacity: .5; }
</style>
