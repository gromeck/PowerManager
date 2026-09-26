// SPDX-License-Identifier: GPL-3.0-or-later

#include "pcf8574.h"
#include "esphome/core/log.h"

namespace esphome::pcf8574 {

static const char *const TAG = "pcf8574";

const char *PCF8574Component::error_name_(i2c::ErrorCode error) {
  switch (error) {
    case i2c::ERROR_OK: return "OK";
    case i2c::ERROR_INVALID_ARGUMENT: return "INVALID_ARGUMENT";
    case i2c::ERROR_NOT_ACKNOWLEDGED: return "NOT_ACKNOWLEDGED";
    case i2c::ERROR_TIMEOUT: return "TIMEOUT";
    case i2c::ERROR_NOT_INITIALIZED: return "NOT_INITIALIZED";
    case i2c::ERROR_TOO_LARGE: return "TOO_LARGE";
    case i2c::ERROR_CRC: return "CRC";
    default: return "UNKNOWN";
  }
}

void PCF8574Component::setup() {
  if (!this->read_gpio_()) {
    ESP_LOGE(TAG, "0x%02X SETUP failed; component disabled", this->address_);
    this->mark_failed();
    return;
  }
  this->write_gpio_();
  this->read_gpio_();
  if (this->interrupt_pin_ != nullptr) {
    this->interrupt_pin_->setup();
    this->interrupt_pin_->attach_interrupt(&PCF8574Component::gpio_intr, this, gpio::INTERRUPT_FALLING_EDGE);
    this->set_invalidate_on_read_(false);
  }
  this->disable_loop();
}

void IRAM_ATTR PCF8574Component::gpio_intr(PCF8574Component *arg) { arg->enable_loop_soon_any_context(); }

void PCF8574Component::loop() {
  this->reset_pin_cache_();
  if (this->interrupt_pin_ != nullptr && this->interrupt_pin_->digital_read()) this->disable_loop();
}

void PCF8574Component::dump_config() {
  ESP_LOGCONFIG(TAG, "PCF8574:\n  Address: 0x%02X\n  Is PCF8575: %s", this->address_, YESNO(this->pcf8575_));
  LOG_PIN("  Interrupt Pin: ", this->interrupt_pin_);
  if (this->is_failed()) ESP_LOGE(TAG, ESP_LOG_MSG_COMM_FAIL);
}

bool PCF8574Component::digital_read_hw(uint8_t pin) { return this->read_gpio_(); }
bool PCF8574Component::digital_read_cache(uint8_t pin) { return this->input_mask_ & (1 << pin); }

void PCF8574Component::digital_write_hw(uint8_t pin, bool value) {
  if (value) this->output_mask_ |= (1 << pin);
  else this->output_mask_ &= ~(1 << pin);
  this->write_gpio_();
}

void PCF8574Component::pin_mode(uint8_t pin, gpio::Flags flags) {
  if (flags == gpio::FLAG_INPUT) {
    this->mode_mask_ &= ~(1 << pin);
    this->write_gpio_();
    if (this->interrupt_pin_ == nullptr) this->enable_loop();
  } else if (flags == gpio::FLAG_OUTPUT) {
    this->mode_mask_ |= 1 << pin;
  }
}

bool PCF8574Component::read_gpio_() {
  if (this->is_failed()) return false;
  uint8_t data[2]{};
  const size_t length = this->pcf8575_ ? 2 : 1;
  const auto error = this->read(data, length);
  if (error != i2c::ERROR_OK) {
    ESP_LOGW(TAG, "0x%02X READ failed error=%u (%s)", this->address_, static_cast<unsigned>(error),
             error_name_(error));
    this->status_set_warning();
    return false;
  }
  this->input_mask_ = this->pcf8575_ ? (uint16_t(data[1]) << 8) | data[0] : data[0];
  this->status_clear_warning();
  return true;
}

bool PCF8574Component::write_gpio_() {
  if (this->is_failed()) return false;
  uint16_t value = this->mode_mask_ & this->output_mask_;
  value |= ~this->mode_mask_;
  uint8_t data[2]{static_cast<uint8_t>(value), static_cast<uint8_t>(value >> 8)};
  const size_t length = this->pcf8575_ ? 2 : 1;
  const auto error = this->write(data, length);
  if (error != i2c::ERROR_OK) {
    ESP_LOGW(TAG, "0x%02X WRITE failed data=0x%02X error=%u (%s)", this->address_, data[0],
             static_cast<unsigned>(error), error_name_(error));
    this->status_set_warning();
    return false;
  }
  this->status_clear_warning();
  if (this->mode_mask_ != 0) {
    this->set_timeout(250, [this]() { this->verify_outputs_(250); });
  }
  return true;
}

void PCF8574Component::verify_outputs_(uint32_t delay_ms) {
  if (!this->read_gpio_()) return;

  const uint16_t expected = (this->mode_mask_ & this->output_mask_) | ~this->mode_mask_;
  const uint16_t relevant_mask = this->pcf8575_ ? this->mode_mask_ : (this->mode_mask_ & 0xFF);
  const uint16_t mismatch = (this->input_mask_ ^ expected) & relevant_mask;
  if (mismatch != 0) {
    ESP_LOGW(TAG, "0x%02X VERIFY mismatch after=%ums expected=0x%02X actual=0x%02X mask=0x%02X", this->address_,
             static_cast<unsigned>(delay_ms), expected & 0xFF, this->input_mask_ & 0xFF, mismatch & 0xFF);
    this->status_set_warning();
    return;
  }
}

float PCF8574Component::get_setup_priority() const { return setup_priority::IO; }
void PCF8574GPIOPin::setup() { pin_mode(flags_); }
void PCF8574GPIOPin::pin_mode(gpio::Flags flags) { this->parent_->pin_mode(this->pin_, flags); }
bool PCF8574GPIOPin::digital_read() { return this->parent_->digital_read(this->pin_) != this->inverted_; }
void PCF8574GPIOPin::digital_write(bool value) { this->parent_->digital_write(this->pin_, value != this->inverted_); }
size_t PCF8574GPIOPin::dump_summary(char *buffer, size_t len) const {
  return buf_append_printf(buffer, len, 0, "%u via PCF8574", this->pin_);
}

}  // namespace esphome::pcf8574
