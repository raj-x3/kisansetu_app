// A single, shared connection to the backend API.
//
// Every request automatically gets the saved login token attached
// (if one exists), so individual pages never have to think about it.

import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Turns whatever the backend sent back into one plain, readable
// message, so every page can show errors the same simple way.
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (
      error.response?.data?.error ||
      "Couldn't reach the server. Please check your connection and try again."
    );
  }
  return "Something unexpected happened. Please try again.";
}
