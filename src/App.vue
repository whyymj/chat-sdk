<script setup lang="ts">
import ChatDialog from './components/ChatDialog.vue'
import { useAgent } from './composables/useAgent'
import { useAgentConfig } from './composables/useAgentConfig'

const config = useAgentConfig()
const { chat } = useAgent(config)
</script>

<template>
  <div class="app">
    <ChatDialog :fetch-response="chat" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
  background: #f5f7fa;
}
</style>
