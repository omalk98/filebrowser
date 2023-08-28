import Vue from "vue";
import { defineStore } from "pinia";
import { useFileStore } from "./file";
import { files as api } from "@/api";
import throttle from "lodash.throttle";
import buttons from "@/utils/buttons";

const UPLOADS_LIMIT = 5;

const beforeUnload = (event) => {
  event.preventDefault();
  event.returnValue = "";
};

export const useUploadStore = defineStore("upload", {
  // convert to a function
  state: () => ({
    id: 0,
    sizes: [],
    progress: [],
    queue: [],
    uploads: {},
  }),
  getters: {
    // user and jwt getter removed, no longer needed
    getProgress: (state) => {
      if (state.progress.length == 0) {
        return 0;
      }

      const totalSize = state.sizes.reduce((a, b) => a + b, 0);

      const sum = state.progress.reduce((acc, val) => acc + val);
      return Math.ceil((sum / totalSize) * 100);
    },
    filesInUploadCount: (state) => {
      const total = Object.keys(state.uploads).length + state.queue.length;
      return total;
    },
    filesInUpload: (state) => {
      const files = [];

      for (let index in state.uploads) {
        const upload = state.uploads[index];
        const id = upload.id;
        const type = upload.type;
        const name = upload.file.name;
        const size = state.sizes[id];
        const isDir = upload.file.isDir;
        const progress = isDir
          ? 100
          : Math.ceil((state.progress[id] / size) * 100);

        files.push({
          id,
          name,
          progress,
          type,
          isDir,
        });
      }

      return files.sort((a, b) => a.progress - b.progress);
    },
  },
  actions: {
    // no context as first argument, use `this` instead
    setProgress({ id, loaded }) {
      Vue.set(this.progress, id, loaded);
    },
    reset() {
      this.id = 0;
      this.sizes = [];
      this.progress = [];
    },
    addJob(item) {
      this.queue.push(item);
      this.sizes[this.id] = item.file.size;
      this.id++;
    },
    moveJob() {
      const item = this.queue[0];
      this.queue.shift();
      Vue.set(this.uploads, item.id, item);
    },
    removeJob(id) {
      Vue.delete(this.uploads, id);
      delete this.uploads[id];
    },
    upload(item) {
      let uploadsCount = Object.keys(this.uploads).length;

      let isQueueEmpty = this.queue.length == 0;
      let isUploadsEmpty = uploadsCount == 0;

      if (isQueueEmpty && isUploadsEmpty) {
        window.addEventListener("beforeunload", beforeUnload);
        buttons.loading("upload");
      }

      this.addJob(item);
      this.processUploads();
    },
    finishUpload(item) {
      this.setProgress({ id: item.id, loaded: item.file.size });
      this.removeJob(item.id);
      this.processUploads();
    },
    async processUploads() {
      const uploadsCount = Object.keys(this.uploads).length;

      const isBellowLimit = uploadsCount < UPLOADS_LIMIT;
      const isQueueEmpty = this.queue.length == 0;
      const isUploadsEmpty = uploadsCount == 0;

      const isFinished = isQueueEmpty && isUploadsEmpty;
      const canProcess = isBellowLimit && !isQueueEmpty;

      if (isFinished) {
        const fileStore = useFileStore();
        window.removeEventListener("beforeunload", beforeUnload);
        buttons.success("upload");
        this.reset();
        fileStore.reload = true;
      }

      if (canProcess) {
        const item = this.queue[0];
        this.moveJob();

        if (item.file.isDir) {
          await api.post(item.path).catch(Vue.prototype.$showError);
        } else {
          let onUpload = throttle(
            (event) =>
              this.setProgress({
                id: item.id,
                loaded: event.loaded,
              }),
            100,
            { leading: true, trailing: false }
          );

          await api
            .post(item.path, item.file, item.overwrite, onUpload)
            .catch(Vue.prototype.$showError);
        }

        this.finishUpload(item);
      }
    },
    // easily reset state using `$reset`
    clearUpload() {
      this.$reset();
    },
  },
});