// Headless push handlers must register before the app component so a
// notification can ring the phone while the app is closed (no-op without push).
import "./src/services/pushBackground";
import "expo-router/entry";
