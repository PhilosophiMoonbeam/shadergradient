<script lang="ts">
  // This component must fail during construction below the real CanvasScene,
  // before either an effect, a mount callback, or a scheduler frame can run.
  throw new Error('Binding fixture: synchronous child initialization failure.')
</script>
