import { initTracing } from './tracing';

initTracing();

// Keep this import last so framework modules are loaded after tracing patches.
import './main';
