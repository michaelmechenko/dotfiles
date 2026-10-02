// Uses the very same helper called by taskbar and SNI image-loading paths.
#include <cassert>
#include <cstring>
#include <gdkmm/pixbuf.h>
#include <gdkmm/wrap_init.h>
#include <glibmm/init.h>
#include "util/grayscale_icon.hpp"

int main() {
  Glib::init();
  Gdk::wrap_init();
  assert(!waybar::util::grayscale_icon({}));
  for (bool alpha : {false, true}) {
    auto source = Gdk::Pixbuf::create(Gdk::COLORSPACE_RGB, alpha, 8, 3, 2);
    const int channels = source->get_n_channels();
    const int stride = source->get_rowstride();
    for (int y = 0; y < 2; ++y) {
      for (int x = 0; x < 3; ++x) {
        auto pixel = source->get_pixels() + y * stride + x * channels;
        pixel[0] = 210; pixel[1] = 80; pixel[2] = 30;
        if (alpha) pixel[3] = x * 127;
      }
    }
    auto original = source->copy();
    auto gray = waybar::util::grayscale_icon(source);
    assert(gray->get_width() == 3 && gray->get_height() == 2);
    assert(gray->get_n_channels() == channels);
    for (int y = 0; y < 2; ++y) {
      for (int x = 0; x < 3; ++x) {
        const auto pixel = gray->get_pixels() + y * gray->get_rowstride() + x * channels;
        const auto before = original->get_pixels() + y * original->get_rowstride() + x * channels;
        const auto after = source->get_pixels() + y * stride + x * channels;
        assert(pixel[0] == pixel[1] && pixel[1] == pixel[2]);
        assert(pixel[0] > 0);
        if (alpha) assert(pixel[3] == before[3]);
        assert(std::memcmp(before, after, channels) == 0);
      }
    }
  }
}
