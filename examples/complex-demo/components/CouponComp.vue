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
.cmp-coupon {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  padding: 16px;
  background: linear-gradient(135deg, #fff1f3 0%, #ffffff 65%);
  border: 1px dashed #f9a8b8;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(225, 29, 72, 0.06);
  transition: box-shadow .2s ease, transform .2s ease;
  min-width: 0; overflow: hidden;
}
.cmp-coupon.available:hover {
  box-shadow: 0 6px 16px rgba(225, 29, 72, 0.14);
  transform: translateY(-2px);
}
.coupon-amount {
  color: #e11d48; font-size: 30px; font-weight: 800; line-height: 1;
  letter-spacing: -0.5px;
}
.coupon-amount small { font-size: 15px; font-weight: 600; }
.coupon-meta { flex: 1; min-width: 0; width: 100%; }
.coupon-label { font-weight: 600; font-size: 14px; color: #1f2937; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.coupon-threshold { color: #6b7280; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.coupon-status {
  display: inline-block; margin-top: 8px;
  padding: 4px 14px; font-size: 12px; font-weight: 600;
  border-radius: 999px; line-height: 1.6;
  white-space: nowrap;
}
.cmp-coupon.available .coupon-status { background: #e11d48; color: #fff; }
.cmp-coupon.claimed .coupon-status { background: #f3f4f6; color: #6b7280; }
.cmp-coupon.used .coupon-status,
.cmp-coupon.expired .coupon-status { background: #f3f4f6; color: #9ca3af; }
.cmp-coupon.claimed { opacity: .75; }
.cmp-coupon.used, .cmp-coupon.expired { filter: grayscale(1); opacity: .55; }
</style>
