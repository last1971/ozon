import axios from "axios";

const url = import.meta.env.VITE_URL;

export default axios.create({
    baseURL: url
})