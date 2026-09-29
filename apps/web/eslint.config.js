import nextVitals from "eslint-config-next/core-web-vitals";
import base from "@closer/config/eslint";

const config = [...nextVitals, ...base];

export default config;
