import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { getAccessToken } from "../lib/supabase";

const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_API_URL || "http://localhost:8010";

const agentApiClient: AxiosInstance = axios.create({
  baseURL: AGENT_API_BASE_URL,
  timeout: 90000,
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
      console.error(
        `Agent API Error (${error.response.status}):`,
        error.response.data,
      );
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
