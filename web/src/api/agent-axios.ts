import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { getAccessToken } from "../lib/supabase";

const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_API_URL || "http://localhost:8010";

const agentApiClient: AxiosInstance = axios.create({
  baseURL: AGENT_API_BASE_URL,
  // 180s — plan-mode turns with multiple clarifier questions and a full
  // hierarchy envelope can take 40-90s on reasoning models. Must exceed
  // the agent's OpenAI adapter ceiling (90s) plus 2-3 tool-loop round trips.
  timeout: 180000,
  headers: {
    "Content-Type": "application/json",
  },
});

agentApiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const token = await getAccessToken();

      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        const guestUserId = localStorage.getItem("prdigy_guest_user_id");
        if (guestUserId && config.headers) {
          config.headers["X-Guest-User-Id"] = guestUserId;
        }
      }
    } catch (error) {
      console.error("Error adding auth headers for agent API:", error);
    }

    return config;
  },
  (error) => Promise.reject(error),
);

agentApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // 404s on the agent are commonly expected: the trace-events endpoint
      // 404s during the ~1s cold-start race between `startTracePolling` and
      // the agent creating the trace for a new message, and the /messages
      // endpoint 404s on Redis TTL expiry (the caller rehydrates and
      // retries). Keep these out of the error log so real failures stand
      // out; callers still receive the rejected promise and decide.
      const status = error.response.status;
      if (status === 404) {
        console.debug(
          `Agent API 404 (caller will handle):`,
          error.config?.url,
        );
      } else {
        console.error(
          `Agent API Error (${status}):`,
          error.response.data,
        );
      }
    } else if (error.request) {
      console.error("No response from agent server - Check your connection");
    } else {
      console.error("Agent request error:", error.message);
    }

    return Promise.reject(error);
  },
);

export default agentApiClient;
export { AGENT_API_BASE_URL };
