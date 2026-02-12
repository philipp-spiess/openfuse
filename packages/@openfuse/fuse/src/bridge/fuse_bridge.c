#define _FILE_OFFSET_BITS 64
#define FUSE_USE_VERSION 26

#include <errno.h>
#include <limits.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include <fuse.h>

typedef int (*bridge_getattr_fn)(const char* path, uint64_t* size, uint32_t* mode, uint32_t* nlink, uint32_t* uid, uint32_t* gid);
typedef int (*bridge_readdir_fn)(const char* path, void* buf, void* filler);
typedef int (*bridge_open_fn)(const char* path, int flags);
typedef int (*bridge_read_fn)(const char* path, char* buf, int size, int64_t offset);
typedef int (*bridge_write_fn)(const char* path, const char* buf, int size, int64_t offset);
typedef int (*bridge_create_fn)(const char* path, uint32_t mode);
typedef int (*bridge_unlink_fn)(const char* path);
typedef int (*bridge_mkdir_fn)(const char* path, uint32_t mode);
typedef int (*bridge_rmdir_fn)(const char* path);

static bridge_getattr_fn g_getattr_cb = NULL;
static bridge_readdir_fn g_readdir_cb = NULL;
static bridge_open_fn g_open_cb = NULL;
static bridge_read_fn g_read_cb = NULL;
static bridge_write_fn g_write_cb = NULL;
static bridge_create_fn g_create_cb = NULL;
static bridge_unlink_fn g_unlink_cb = NULL;
static bridge_mkdir_fn g_mkdir_cb = NULL;
static bridge_rmdir_fn g_rmdir_cb = NULL;

static struct fuse_operations g_ops;
static struct fuse* g_fuse = NULL;
static struct fuse_chan* g_chan = NULL;
static pthread_t g_loop_thread;
static int g_loop_thread_running = 0;
static int g_loop_thread_started = 0;
static char g_mountpoint[PATH_MAX] = {0};
static pthread_mutex_t g_state_mutex = PTHREAD_MUTEX_INITIALIZER;

typedef int (*bridge_fill_dir_fn)(void* buf, const char* name, const struct stat* stbuf, off_t off);

static int bridge_op_getattr(const char* path, struct stat* stbuf) {
  if (!g_getattr_cb) {
    return -ENOSYS;
  }

  memset(stbuf, 0, sizeof(*stbuf));

  uint64_t size = 0;
  uint32_t mode = 0;
  uint32_t nlink = 1;
  uint32_t uid = (uint32_t)getuid();
  uint32_t gid = (uint32_t)getgid();

  int rc = g_getattr_cb(path, &size, &mode, &nlink, &uid, &gid);
  if (rc != 0) {
    return rc;
  }

  stbuf->st_mode = (mode_t)mode;
  stbuf->st_nlink = (nlink_t)nlink;
  stbuf->st_size = (off_t)size;
  stbuf->st_uid = (uid_t)uid;
  stbuf->st_gid = (gid_t)gid;

  return 0;
}

static int bridge_op_readdir(
  const char* path,
  void* buf,
  fuse_fill_dir_t filler,
  off_t offset,
  struct fuse_file_info* fi
) {
  (void)offset;
  (void)fi;

  if (!g_readdir_cb) {
    return -ENOSYS;
  }

  if (filler(buf, ".", NULL, 0) != 0) {
    return 0;
  }

  if (filler(buf, "..", NULL, 0) != 0) {
    return 0;
  }

  return g_readdir_cb(path, buf, (void*)filler);
}

static int bridge_op_open(const char* path, struct fuse_file_info* fi) {
  if (!g_open_cb) {
    return -ENOSYS;
  }

  int flags = 0;
  if (fi) {
    flags = fi->flags;
  }

  return g_open_cb(path, flags);
}

static int bridge_op_read(
  const char* path,
  char* buf,
  size_t size,
  off_t offset,
  struct fuse_file_info* fi
) {
  (void)fi;

  if (!g_read_cb) {
    return -ENOSYS;
  }

  int max_size = (size > INT32_MAX) ? INT32_MAX : (int)size;
  return g_read_cb(path, buf, max_size, (int64_t)offset);
}

static int bridge_op_write(
  const char* path,
  const char* buf,
  size_t size,
  off_t offset,
  struct fuse_file_info* fi
) {
  (void)fi;

  if (!g_write_cb) {
    return -ENOSYS;
  }

  int max_size = (size > INT32_MAX) ? INT32_MAX : (int)size;
  return g_write_cb(path, buf, max_size, (int64_t)offset);
}

static int bridge_op_create(const char* path, mode_t mode, struct fuse_file_info* fi) {
  (void)fi;

  if (!g_create_cb) {
    return -ENOSYS;
  }

  return g_create_cb(path, (uint32_t)(mode & 07777));
}

static int bridge_op_unlink(const char* path) {
  if (!g_unlink_cb) {
    return -ENOSYS;
  }

  return g_unlink_cb(path);
}

static int bridge_op_mkdir(const char* path, mode_t mode) {
  if (!g_mkdir_cb) {
    return -ENOSYS;
  }

  return g_mkdir_cb(path, (uint32_t)(mode & 07777));
}

static int bridge_op_rmdir(const char* path) {
  if (!g_rmdir_cb) {
    return -ENOSYS;
  }

  return g_rmdir_cb(path);
}

void fuse_bridge_set_callbacks(
  bridge_getattr_fn getattr,
  bridge_readdir_fn readdir,
  bridge_open_fn open,
  bridge_read_fn read,
  bridge_write_fn write,
  bridge_create_fn create,
  bridge_unlink_fn unlink_cb,
  bridge_mkdir_fn mkdir_cb,
  bridge_rmdir_fn rmdir_cb
) {
  g_getattr_cb = getattr;
  g_readdir_cb = readdir;
  g_open_cb = open;
  g_read_cb = read;
  g_write_cb = write;
  g_create_cb = create;
  g_unlink_cb = unlink_cb;
  g_mkdir_cb = mkdir_cb;
  g_rmdir_cb = rmdir_cb;
}

int fuse_bridge_fill_dir(void* filler_ptr, void* buf, const char* name) {
  if (!filler_ptr || !buf || !name) {
    return -EINVAL;
  }

  bridge_fill_dir_fn filler = (bridge_fill_dir_fn)filler_ptr;
  return filler(buf, name, NULL, 0);
}

static void* bridge_loop_thread_main(void* arg) {
  struct fuse* fuse_instance = (struct fuse*)arg;
  (void)fuse_loop(fuse_instance);

  pthread_mutex_lock(&g_state_mutex);
  g_loop_thread_running = 0;
  pthread_mutex_unlock(&g_state_mutex);

  return NULL;
}

int fuse_bridge_mount(const char* mountpoint) {
  if (!mountpoint || mountpoint[0] == '\0') {
    return -EINVAL;
  }

  pthread_mutex_lock(&g_state_mutex);

  if (g_fuse != NULL) {
    pthread_mutex_unlock(&g_state_mutex);
    return -EBUSY;
  }

  if (!g_getattr_cb || !g_readdir_cb || !g_open_cb || !g_read_cb || !g_write_cb || !g_create_cb || !g_unlink_cb || !g_mkdir_cb || !g_rmdir_cb) {
    pthread_mutex_unlock(&g_state_mutex);
    return -EINVAL;
  }

  memset(&g_ops, 0, sizeof(g_ops));
  g_ops.getattr = bridge_op_getattr;
  g_ops.readdir = bridge_op_readdir;
  g_ops.open = bridge_op_open;
  g_ops.read = bridge_op_read;
  g_ops.write = bridge_op_write;
  g_ops.create = bridge_op_create;
  g_ops.unlink = bridge_op_unlink;
  g_ops.mkdir = bridge_op_mkdir;
  g_ops.rmdir = bridge_op_rmdir;

  char arg0[] = "openfuse";
  char arg1[] = "-f";
  char* argv[] = { arg0, arg1 };
  struct fuse_args args = FUSE_ARGS_INIT(2, argv);

  struct fuse_chan* chan = fuse_mount(mountpoint, &args);
  if (!chan) {
    fuse_opt_free_args(&args);
    int rc = (errno != 0) ? -errno : -EIO;
    pthread_mutex_unlock(&g_state_mutex);
    return rc;
  }

  struct fuse* fuse_instance = fuse_new(chan, &args, &g_ops, sizeof(g_ops), NULL);
  fuse_opt_free_args(&args);

  if (!fuse_instance) {
    fuse_unmount(mountpoint, chan);
    pthread_mutex_unlock(&g_state_mutex);
    return -EIO;
  }

  g_fuse = fuse_instance;
  g_chan = chan;
  g_mountpoint[0] = '\0';
  strncpy(g_mountpoint, mountpoint, sizeof(g_mountpoint) - 1);

  int thread_rc = pthread_create(&g_loop_thread, NULL, bridge_loop_thread_main, fuse_instance);
  if (thread_rc != 0) {
    g_fuse = NULL;
    g_chan = NULL;
    g_mountpoint[0] = '\0';
    fuse_destroy(fuse_instance);
    fuse_unmount(mountpoint, chan);
    pthread_mutex_unlock(&g_state_mutex);
    return -thread_rc;
  }

  g_loop_thread_started = 1;
  g_loop_thread_running = 1;

  pthread_mutex_unlock(&g_state_mutex);
  return 0;
}

void fuse_bridge_unmount(const char* mountpoint) {
  pthread_mutex_lock(&g_state_mutex);

  struct fuse* fuse_instance = g_fuse;
  struct fuse_chan* chan = g_chan;
  int should_join = g_loop_thread_started;
  pthread_t loop_thread = g_loop_thread;

  if (!fuse_instance) {
    pthread_mutex_unlock(&g_state_mutex);
    return;
  }

  fuse_exit(fuse_instance);

  const char* effective_mountpoint = mountpoint;
  if (!effective_mountpoint || effective_mountpoint[0] == '\0') {
    effective_mountpoint = g_mountpoint;
  }

  if (chan && effective_mountpoint && effective_mountpoint[0] != '\0') {
    fuse_unmount(effective_mountpoint, chan);
  }

  pthread_mutex_unlock(&g_state_mutex);

  if (should_join) {
    (void)pthread_join(loop_thread, NULL);
  }

  pthread_mutex_lock(&g_state_mutex);

  if (g_fuse) {
    fuse_destroy(g_fuse);
  }

  g_fuse = NULL;
  g_chan = NULL;
  g_loop_thread_started = 0;
  g_loop_thread_running = 0;
  g_mountpoint[0] = '\0';

  pthread_mutex_unlock(&g_state_mutex);
}
