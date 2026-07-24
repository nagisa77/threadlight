#include <AppKit/AppKit.h>
#include <ApplicationServices/ApplicationServices.h>
#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

class AXRef {
public:
  AXRef() = default;
  explicit AXRef(AXUIElementRef value) : value_(value) {}
  AXRef(const AXRef &) = delete;
  AXRef &operator=(const AXRef &) = delete;
  AXRef(AXRef &&other) noexcept : value_(other.value_) {
    other.value_ = nullptr;
  }
  AXRef &operator=(AXRef &&other) noexcept {
    if (this == &other)
      return *this;
    reset(other.value_);
    other.value_ = nullptr;
    return *this;
  }
  ~AXRef() { reset(); }

  AXUIElementRef get() const { return value_; }
  explicit operator bool() const { return value_ != nullptr; }

  void reset(AXUIElementRef value = nullptr) {
    if (value_)
      CFRelease(value_);
    value_ = value;
  }

private:
  AXUIElementRef value_ = nullptr;
};

std::string StringValue(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    throw std::runtime_error("Native computer input expects a JSON string");
  }
  std::string output(length, '\0');
  napi_get_value_string_utf8(env, value, output.data(), output.size() + 1,
                             &length);
  return output;
}

NSString *String(NSDictionary *value, NSString *key) {
  id candidate = value[key];
  return [candidate isKindOfClass:[NSString class]] ? candidate : nil;
}

NSArray *Array(NSDictionary *value, NSString *key) {
  id candidate = value[key];
  return [candidate isKindOfClass:[NSArray class]] ? candidate : @[];
}

std::optional<double> Number(NSDictionary *value, NSString *key) {
  id candidate = value[key];
  if (![candidate isKindOfClass:[NSNumber class]])
    return std::nullopt;
  return [candidate doubleValue];
}

std::optional<pid_t> ProcessId(NSDictionary *value) {
  auto number = Number(value, @"processId");
  if (!number || *number <= 0)
    return std::nullopt;
  return static_cast<pid_t>(*number);
}

CGPoint Point(NSDictionary *value) {
  return CGPointMake(Number(value, @"x").value_or(0),
                     Number(value, @"y").value_or(0));
}

bool HasAction(AXUIElementRef element, CFStringRef desired) {
  CFArrayRef actions = nullptr;
  if (AXUIElementCopyActionNames(element, &actions) != kAXErrorSuccess ||
      !actions) {
    return false;
  }
  const bool found = CFArrayContainsValue(
      actions, CFRangeMake(0, CFArrayGetCount(actions)), desired);
  CFRelease(actions);
  return found;
}

AXRef CopyParent(AXUIElementRef element) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXParentAttribute, &value) !=
          kAXErrorSuccess ||
      !value) {
    return AXRef();
  }
  if (CFGetTypeID(value) != AXUIElementGetTypeID()) {
    CFRelease(value);
    return AXRef();
  }
  return AXRef(static_cast<AXUIElementRef>(value));
}

bool HasRole(AXUIElementRef element, CFStringRef desired) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &value) !=
          kAXErrorSuccess ||
      !value) {
    return false;
  }
  const bool matches =
      CFGetTypeID(value) == CFStringGetTypeID() && CFEqual(value, desired);
  CFRelease(value);
  return matches;
}

AXRef CopyElementAt(pid_t pid, CGPoint point) {
  AXRef application(AXUIElementCreateApplication(pid));
  AXUIElementRef element = nullptr;
  if (AXUIElementCopyElementAtPosition(
          application.get(), static_cast<float>(point.x),
          static_cast<float>(point.y), &element) != kAXErrorSuccess) {
    return AXRef();
  }
  return AXRef(element);
}

AXRef CopyFocusedElement(pid_t pid) {
  AXRef application(AXUIElementCreateApplication(pid));
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(application.get(),
                                    kAXFocusedUIElementAttribute,
                                    &value) != kAXErrorSuccess ||
      !value) {
    return AXRef();
  }
  if (CFGetTypeID(value) != AXUIElementGetTypeID()) {
    CFRelease(value);
    return AXRef();
  }
  return AXRef(static_cast<AXUIElementRef>(value));
}

AXRef NearestWithAction(AXUIElementRef start, CFStringRef action) {
  AXRef current(static_cast<AXUIElementRef>(CFRetain(start)));
  while (current) {
    if (HasAction(current.get(), action))
      return current;
    current = CopyParent(current.get());
  }
  return AXRef();
}

AXRef NearestWithRole(AXUIElementRef start, CFStringRef role) {
  AXRef current(static_cast<AXUIElementRef>(CFRetain(start)));
  while (current) {
    if (HasRole(current.get(), role))
      return current;
    current = CopyParent(current.get());
  }
  return AXRef();
}

AXRef NearestAdjustable(AXUIElementRef start) {
  AXRef current(static_cast<AXUIElementRef>(CFRetain(start)));
  while (current) {
    if (HasAction(current.get(), kAXIncrementAction) &&
        HasAction(current.get(), kAXDecrementAction)) {
      return current;
    }
    current = CopyParent(current.get());
  }
  return AXRef();
}

AXRef FocusNearest(AXUIElementRef start) {
  AXRef current(static_cast<AXUIElementRef>(CFRetain(start)));
  while (current) {
    if (AXUIElementSetAttributeValue(current.get(), kAXFocusedAttribute,
                                     kCFBooleanTrue) == kAXErrorSuccess) {
      return current;
    }
    current = CopyParent(current.get());
  }
  return AXRef();
}

CFArrayRef CopyElementArray(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) !=
          kAXErrorSuccess ||
      !value) {
    return nullptr;
  }
  if (CFGetTypeID(value) != CFArrayGetTypeID()) {
    CFRelease(value);
    return nullptr;
  }
  return static_cast<CFArrayRef>(value);
}

std::optional<double> CopyNumber(AXUIElementRef element,
                                 CFStringRef attribute) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) !=
          kAXErrorSuccess ||
      !value) {
    return std::nullopt;
  }
  double result = 0;
  const bool valid = CFGetTypeID(value) == CFNumberGetTypeID() &&
                     CFNumberGetValue(static_cast<CFNumberRef>(value),
                                      kCFNumberDoubleType, &result);
  CFRelease(value);
  return valid ? std::optional<double>(result) : std::nullopt;
}

std::optional<CGPoint> CopyPoint(AXUIElementRef element,
                                 CFStringRef attribute) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) !=
          kAXErrorSuccess ||
      !value) {
    return std::nullopt;
  }
  CGPoint result{};
  const bool valid =
      CFGetTypeID(value) == AXValueGetTypeID() &&
      AXValueGetType(static_cast<AXValueRef>(value)) == kAXValueCGPointType &&
      AXValueGetValue(static_cast<AXValueRef>(value),
                      static_cast<AXValueType>(kAXValueCGPointType), &result);
  CFRelease(value);
  return valid ? std::optional<CGPoint>(result) : std::nullopt;
}

std::optional<CGSize> CopySize(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) !=
          kAXErrorSuccess ||
      !value) {
    return std::nullopt;
  }
  CGSize result{};
  const bool valid =
      CFGetTypeID(value) == AXValueGetTypeID() &&
      AXValueGetType(static_cast<AXValueRef>(value)) == kAXValueCGSizeType &&
      AXValueGetValue(static_cast<AXValueRef>(value),
                      static_cast<AXValueType>(kAXValueCGSizeType), &result);
  CFRelease(value);
  return valid ? std::optional<CGSize>(result) : std::nullopt;
}

std::optional<CGRect> CopyBounds(AXUIElementRef element) {
  const auto position = CopyPoint(element, kAXPositionAttribute);
  const auto size = CopySize(element, kAXSizeAttribute);
  if (!position || !size)
    return std::nullopt;
  return CGRectMake(position->x, position->y, size->width, size->height);
}

bool Contains(CGRect bounds, CGPoint point) {
  return point.x >= CGRectGetMinX(bounds) && point.x <= CGRectGetMaxX(bounds) &&
         point.y >= CGRectGetMinY(bounds) && point.y <= CGRectGetMaxY(bounds);
}

enum class ActionableKind {
  Click,
  Adjustable,
};

bool Matches(AXUIElementRef element, ActionableKind kind) {
  if (kind == ActionableKind::Click) {
    return HasAction(element, kAXPressAction) || HasRole(element, kAXRowRole);
  }
  return HasAction(element, kAXIncrementAction) &&
         HasAction(element, kAXDecrementAction);
}

struct SpatialMatch {
  AXUIElementRef element = nullptr;
  double area = std::numeric_limits<double>::infinity();
  int depth = -1;
  int visited = 0;

  ~SpatialMatch() {
    if (element)
      CFRelease(element);
  }

  AXRef Take() {
    AXRef result(element);
    element = nullptr;
    return result;
  }
};

void FindSpatialMatch(AXUIElementRef element, CGPoint point,
                      ActionableKind kind, int depth, SpatialMatch &result) {
  constexpr int kMaximumDepth = 32;
  constexpr int kMaximumElements = 8'000;
  if (!element || depth > kMaximumDepth ||
      result.visited++ >= kMaximumElements) {
    return;
  }

  const auto bounds = CopyBounds(element);
  if (bounds && !Contains(*bounds, point))
    return;

  if (bounds && bounds->size.width > 0 && bounds->size.height > 0 &&
      Matches(element, kind)) {
    const double area = bounds->size.width * bounds->size.height;
    if (!result.element || area < result.area ||
        (area == result.area && depth > result.depth)) {
      if (result.element)
        CFRelease(result.element);
      result.element = static_cast<AXUIElementRef>(CFRetain(element));
      result.area = area;
      result.depth = depth;
    }
  }

  CFArrayRef children = CopyElementArray(element, kAXChildrenAttribute);
  if (!children)
    return;
  const CFIndex count = CFArrayGetCount(children);
  for (CFIndex index = 0; index < count; index += 1) {
    CFTypeRef child = CFArrayGetValueAtIndex(children, index);
    if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) {
      FindSpatialMatch(static_cast<AXUIElementRef>(child), point, kind,
                       depth + 1, result);
    }
  }
  CFRelease(children);
}

AXRef FindActionableAt(pid_t pid, CGPoint point, ActionableKind kind) {
  AXRef application(AXUIElementCreateApplication(pid));
  SpatialMatch result;
  CFArrayRef windows = CopyElementArray(application.get(), kAXWindowsAttribute);
  if (windows) {
    const CFIndex count = CFArrayGetCount(windows);
    for (CFIndex index = 0; index < count; index += 1) {
      CFTypeRef window = CFArrayGetValueAtIndex(windows, index);
      if (window && CFGetTypeID(window) == AXUIElementGetTypeID()) {
        FindSpatialMatch(static_cast<AXUIElementRef>(window), point, kind, 0,
                         result);
      }
    }
    CFRelease(windows);
  } else {
    FindSpatialMatch(application.get(), point, kind, 0, result);
  }
  return result.Take();
}

bool SelectRow(AXUIElementRef row) {
  if (AXUIElementSetAttributeValue(row, kAXSelectedAttribute, kCFBooleanTrue) ==
      kAXErrorSuccess) {
    return true;
  }

  AXRef current = CopyParent(row);
  while (current) {
    if (HasRole(current.get(), kAXOutlineRole)) {
      const void *values[] = {row};
      CFArrayRef selectedRows =
          CFArrayCreate(kCFAllocatorDefault, values, 1, &kCFTypeArrayCallBacks);
      const AXError error = AXUIElementSetAttributeValue(
          current.get(), kAXSelectedRowsAttribute, selectedRows);
      CFRelease(selectedRows);
      return error == kAXErrorSuccess;
    }
    current = CopyParent(current.get());
  }
  return false;
}

bool PerformClick(AXUIElementRef element) {
  if (HasAction(element, kAXPressAction)) {
    return AXUIElementPerformAction(element, kAXPressAction) == kAXErrorSuccess;
  }
  if (HasRole(element, kAXRowRole)) {
    return SelectRow(element);
  }
  return false;
}

bool SetNumber(AXUIElementRef element, CFStringRef attribute, double value) {
  CFNumberRef number =
      CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &value);
  const AXError error =
      AXUIElementSetAttributeValue(element, attribute, number);
  CFRelease(number);
  return error == kAXErrorSuccess;
}

bool SetSliderValue(AXUIElementRef element, CGPoint target) {
  const auto position = CopyPoint(element, kAXPositionAttribute);
  const auto size = CopySize(element, kAXSizeAttribute);
  const double minimum = CopyNumber(element, kAXMinValueAttribute).value_or(0);
  const double maximum = CopyNumber(element, kAXMaxValueAttribute).value_or(1);
  if (!position || !size || maximum <= minimum || size->width <= 0 ||
      size->height <= 0) {
    return false;
  }
  const bool horizontal = size->width >= size->height;
  const double progress = std::clamp(
      horizontal ? (target.x - position->x) / size->width
                 : (position->y + size->height - target.y) / size->height,
      0.0, 1.0);
  return SetNumber(element, kAXValueAttribute,
                   minimum + progress * (maximum - minimum));
}

CGEventFlags ModifierFlags(NSArray *keys) {
  CGEventFlags flags = 0;
  for (id raw in keys) {
    if (![raw isKindOfClass:[NSString class]])
      continue;
    NSString *key = [static_cast<NSString *>(raw) uppercaseString];
    if ([key isEqualToString:@"SHIFT"])
      flags |= kCGEventFlagMaskShift;
    if ([key isEqualToString:@"CTRL"] || [key isEqualToString:@"CONTROL"]) {
      flags |= kCGEventFlagMaskControl;
    }
    if ([key isEqualToString:@"ALT"] || [key isEqualToString:@"OPTION"]) {
      flags |= kCGEventFlagMaskAlternate;
    }
    if ([key isEqualToString:@"META"] || [key isEqualToString:@"CMD"] ||
        [key isEqualToString:@"COMMAND"]) {
      flags |= kCGEventFlagMaskCommand;
    }
  }
  return flags;
}

bool IsModifier(NSString *raw) {
  NSString *key = [raw uppercaseString];
  return [key isEqualToString:@"SHIFT"] || [key isEqualToString:@"CTRL"] ||
         [key isEqualToString:@"CONTROL"] || [key isEqualToString:@"ALT"] ||
         [key isEqualToString:@"OPTION"] || [key isEqualToString:@"META"] ||
         [key isEqualToString:@"CMD"] || [key isEqualToString:@"COMMAND"];
}

std::optional<CGKeyCode> KeyCode(NSString *raw) {
  static NSDictionary<NSString *, NSNumber *> *codes;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    codes = @{
      @"A" : @0,
      @"S" : @1,
      @"D" : @2,
      @"F" : @3,
      @"H" : @4,
      @"G" : @5,
      @"Z" : @6,
      @"X" : @7,
      @"C" : @8,
      @"V" : @9,
      @"B" : @11,
      @"Q" : @12,
      @"W" : @13,
      @"E" : @14,
      @"R" : @15,
      @"Y" : @16,
      @"T" : @17,
      @"1" : @18,
      @"2" : @19,
      @"3" : @20,
      @"4" : @21,
      @"6" : @22,
      @"5" : @23,
      @"=" : @24,
      @"EQUAL" : @24,
      @"9" : @25,
      @"7" : @26,
      @"-" : @27,
      @"MINUS" : @27,
      @"8" : @28,
      @"0" : @29,
      @"]" : @30,
      @"RIGHTBRACKET" : @30,
      @"O" : @31,
      @"U" : @32,
      @"[" : @33,
      @"LEFTBRACKET" : @33,
      @"I" : @34,
      @"P" : @35,
      @"ENTER" : @36,
      @"RETURN" : @36,
      @"L" : @37,
      @"J" : @38,
      @"'" : @39,
      @"QUOTE" : @39,
      @"K" : @40,
      @";" : @41,
      @"SEMICOLON" : @41,
      @"\\" : @42,
      @"BACKSLASH" : @42,
      @"," : @43,
      @"COMMA" : @43,
      @"/" : @44,
      @"SLASH" : @44,
      @"N" : @45,
      @"M" : @46,
      @"." : @47,
      @"PERIOD" : @47,
      @"TAB" : @48,
      @"SPACE" : @49,
      @"`" : @50,
      @"GRAVE" : @50,
      @"BACKSPACE" : @51,
      @"ESC" : @53,
      @"ESCAPE" : @53,
      @"HOME" : @115,
      @"PAGEUP" : @116,
      @"DELETE" : @117,
      @"DEL" : @117,
      @"END" : @119,
      @"PAGEDOWN" : @121,
      @"LEFT" : @123,
      @"ARROWLEFT" : @123,
      @"RIGHT" : @124,
      @"ARROWRIGHT" : @124,
      @"DOWN" : @125,
      @"ARROWDOWN" : @125,
      @"UP" : @126,
      @"ARROWUP" : @126,
      @"F1" : @122,
      @"F2" : @120,
      @"F3" : @99,
      @"F4" : @118,
      @"F5" : @96,
      @"F6" : @97,
      @"F7" : @98,
      @"F8" : @100,
      @"F9" : @101,
      @"F10" : @109,
      @"F11" : @103,
      @"F12" : @111,
      @"F13" : @105,
      @"F14" : @107,
      @"F15" : @113,
      @"F16" : @106,
      @"F17" : @64,
      @"F18" : @79,
      @"F19" : @80,
      @"F20" : @90,
    };
  });
  NSNumber *value = codes[[raw uppercaseString]];
  if (!value)
    return std::nullopt;
  return static_cast<CGKeyCode>([value unsignedShortValue]);
}

void PostEvent(CGEventRef event, bool isVirtual,
               std::optional<pid_t> processId) {
  if (isVirtual) {
    if (!processId) {
      throw std::runtime_error(
          "Virtual input could not resolve the target application");
    }
    CGEventPostToPid(*processId, event);
  } else {
    CGEventPost(kCGHIDEventTap, event);
  }
}

struct ButtonEvents {
  CGEventType down;
  CGEventType up;
  CGEventType drag;
  CGMouseButton button;
};

ButtonEvents EventsForButton(NSString *value) {
  if ([value isEqualToString:@"right"]) {
    return {kCGEventRightMouseDown, kCGEventRightMouseUp,
            kCGEventRightMouseDragged, kCGMouseButtonRight};
  }
  if ([value isEqualToString:@"wheel"] || [value isEqualToString:@"back"] ||
      [value isEqualToString:@"forward"]) {
    return {kCGEventOtherMouseDown, kCGEventOtherMouseUp,
            kCGEventOtherMouseDragged, kCGMouseButtonCenter};
  }
  return {kCGEventLeftMouseDown, kCGEventLeftMouseUp, kCGEventLeftMouseDragged,
          kCGMouseButtonLeft};
}

void PostMouse(CGEventType type, CGPoint point, CGMouseButton button,
               CGEventFlags flags, bool isVirtual,
               std::optional<pid_t> processId) {
  CGEventRef event = CGEventCreateMouseEvent(nullptr, type, point, button);
  CGEventSetFlags(event, flags);
  PostEvent(event, isVirtual, processId);
  CFRelease(event);
}

void Activate(std::optional<pid_t> processId) {
  if (!processId)
    return;
  NSRunningApplication *application =
      [NSRunningApplication runningApplicationWithProcessIdentifier:*processId];
  [application activateWithOptions:NSApplicationActivateIgnoringOtherApps];
}

class Driver {
public:
  explicit Driver(bool isVirtual) : isVirtual_(isVirtual) {}
  ~Driver() {
    if (active_)
      CFRelease(active_);
  }

  void Run(NSArray *actions) {
    if (isVirtual_ && !AXIsProcessTrusted()) {
      throw std::runtime_error(
          "Allow Threadlight in System Settings > Privacy & Security > "
          "Accessibility, then restart Threadlight");
    }
    for (id raw in actions) {
      if (![raw isKindOfClass:[NSDictionary class]])
        continue;
      NSDictionary *action = raw;
      NSString *type = String(action, @"type");
      if ([type isEqualToString:@"click"])
        Click(action, 1);
      else if ([type isEqualToString:@"double_click"])
        Click(action, 2);
      else if ([type isEqualToString:@"move"])
        Move(action);
      else if ([type isEqualToString:@"drag"])
        Drag(action);
      else if ([type isEqualToString:@"scroll"])
        Scroll(action);
      else if ([type isEqualToString:@"keypress"])
        Keypress(action);
      else if ([type isEqualToString:@"type"])
        Type(action);
      else {
        throw std::runtime_error("Unsupported native computer input action");
      }
    }
  }

private:
  bool isVirtual_;
  AXUIElementRef active_ = nullptr;

  void SetActive(AXUIElementRef element) {
    if (active_)
      CFRelease(active_);
    active_ =
        element ? static_cast<AXUIElementRef>(CFRetain(element)) : nullptr;
  }

  void Click(NSDictionary *action, int count) {
    const auto processId = ProcessId(action);
    const CGPoint point = Point(action);
    NSArray *keys = Array(action, @"keys");
    NSString *button = String(action, @"button") ?: @"left";
    if (isVirtual_ && processId && [button isEqualToString:@"left"] &&
        keys.count == 0) {
      AXRef hit = CopyElementAt(*processId, point);
      AXRef clickable;
      if (hit) {
        AXRef focused = FocusNearest(hit.get());
        SetActive(focused ? focused.get() : hit.get());
        clickable = NearestWithAction(hit.get(), kAXPressAction);
        if (!clickable) {
          clickable = NearestWithRole(hit.get(), kAXRowRole);
        }
      }
      if (!clickable) {
        clickable = FindActionableAt(*processId, point, ActionableKind::Click);
      }
      if (clickable) {
        SetActive(clickable.get());
        bool performed = true;
        for (int index = 0; index < count; index += 1) {
          if (!PerformClick(clickable.get())) {
            performed = false;
            break;
          }
          if (index + 1 < count)
            usleep(80'000);
        }
        if (performed)
          return;
      }
    }
    const ButtonEvents events = EventsForButton(button);
    const CGEventFlags flags = ModifierFlags(keys);
    for (int index = 0; index < count; index += 1) {
      PostMouse(events.down, point, events.button, flags, isVirtual_,
                processId);
      usleep(40'000);
      PostMouse(events.up, point, events.button, flags, isVirtual_, processId);
      if (index + 1 < count)
        usleep(80'000);
    }
  }

  void Move(NSDictionary *action) {
    PostMouse(kCGEventMouseMoved, Point(action), kCGMouseButtonLeft,
              ModifierFlags(Array(action, @"keys")), isVirtual_,
              ProcessId(action));
  }

  void Drag(NSDictionary *action) {
    NSArray *path = Array(action, @"path");
    if (path.count == 0)
      return;
    const auto processId = ProcessId(action);
    NSDictionary *firstValue = path.firstObject;
    NSDictionary *lastValue = path.lastObject;
    const CGPoint first = Point(firstValue);
    const CGPoint last = Point(lastValue);
    if (isVirtual_ && processId) {
      AXRef hit = CopyElementAt(*processId, first);
      AXRef adjustable;
      if (hit) {
        adjustable = NearestAdjustable(hit.get());
      }
      if (!adjustable) {
        adjustable =
            FindActionableAt(*processId, first, ActionableKind::Adjustable);
      }
      if (adjustable) {
        SetActive(adjustable.get());
        AXUIElementSetAttributeValue(adjustable.get(), kAXFocusedAttribute,
                                     kCFBooleanTrue);
        if (SetSliderValue(adjustable.get(), last))
          return;
        const double dx = last.x - first.x;
        const double dy = first.y - last.y;
        const double delta = std::abs(dx) >= std::abs(dy) ? dx : dy;
        CFStringRef name = delta >= 0 ? kAXIncrementAction : kAXDecrementAction;
        const int count = std::clamp(
            static_cast<int>(std::ceil(std::abs(delta) / 4)), 1, 100);
        bool adjusted = false;
        for (int index = 0; index < count; index += 1) {
          if (AXUIElementPerformAction(adjustable.get(), name) !=
              kAXErrorSuccess) {
            break;
          }
          adjusted = true;
        }
        if (adjusted)
          return;
      }
    }
    const CGEventFlags flags = ModifierFlags(Array(action, @"keys"));
    PostMouse(kCGEventMouseMoved, first, kCGMouseButtonLeft, flags, isVirtual_,
              processId);
    PostMouse(kCGEventLeftMouseDown, first, kCGMouseButtonLeft, flags,
              isVirtual_, processId);
    for (NSUInteger index = 1; index < path.count; index += 1) {
      usleep(10'000);
      PostMouse(kCGEventLeftMouseDragged, Point(path[index]),
                kCGMouseButtonLeft, flags, isVirtual_, processId);
    }
    PostMouse(kCGEventLeftMouseUp, last, kCGMouseButtonLeft, flags, isVirtual_,
              processId);
  }

  void Scroll(NSDictionary *action) {
    const int32_t vertical = -static_cast<int32_t>(
        std::llround(Number(action, @"scroll_y").value_or(0)));
    const int32_t horizontal = -static_cast<int32_t>(
        std::llround(Number(action, @"scroll_x").value_or(0)));
    CGEventRef event = CGEventCreateScrollWheelEvent(
        nullptr, kCGScrollEventUnitPixel, 2, vertical, horizontal);
    CGEventSetLocation(event, Point(action));
    CGEventSetFlags(event, ModifierFlags(Array(action, @"keys")));
    PostEvent(event, isVirtual_, ProcessId(action));
    CFRelease(event);
  }

  bool AdjustWithKey(NSString *raw) {
    if (!active_)
      return false;
    AXRef adjustable = NearestAdjustable(active_);
    if (!adjustable)
      return false;
    NSString *key = [raw uppercaseString];
    if ([key isEqualToString:@"END"]) {
      auto maximum = CopyNumber(adjustable.get(), kAXMaxValueAttribute);
      return maximum &&
             SetNumber(adjustable.get(), kAXValueAttribute, *maximum);
    }
    if ([key isEqualToString:@"HOME"]) {
      auto minimum = CopyNumber(adjustable.get(), kAXMinValueAttribute);
      return minimum &&
             SetNumber(adjustable.get(), kAXValueAttribute, *minimum);
    }
    CFStringRef action = nullptr;
    if ([key isEqualToString:@"RIGHT"] || [key isEqualToString:@"ARROWRIGHT"] ||
        [key isEqualToString:@"UP"] || [key isEqualToString:@"ARROWUP"]) {
      action = kAXIncrementAction;
    }
    if ([key isEqualToString:@"LEFT"] || [key isEqualToString:@"ARROWLEFT"] ||
        [key isEqualToString:@"DOWN"] || [key isEqualToString:@"ARROWDOWN"]) {
      action = kAXDecrementAction;
    }
    return action && AXUIElementPerformAction(adjustable.get(), action) ==
                         kAXErrorSuccess;
  }

  void Keypress(NSDictionary *action) {
    const auto processId = ProcessId(action);
    NSArray *keys = Array(action, @"keys");
    if (!isVirtual_)
      Activate(processId);
    const CGEventFlags flags = ModifierFlags(keys);
    for (id raw in keys) {
      if (![raw isKindOfClass:[NSString class]] ||
          IsModifier(static_cast<NSString *>(raw))) {
        continue;
      }
      NSString *key = raw;
      if (isVirtual_ && AdjustWithKey(key))
        continue;
      const auto code = KeyCode(key);
      if (!code) {
        throw std::runtime_error("Unsupported native virtual key");
      }
      CGEventRef down = CGEventCreateKeyboardEvent(nullptr, *code, true);
      CGEventSetFlags(down, flags);
      PostEvent(down, isVirtual_, processId);
      CFRelease(down);
      usleep(10'000);
      CGEventRef up = CGEventCreateKeyboardEvent(nullptr, *code, false);
      CGEventSetFlags(up, flags);
      PostEvent(up, isVirtual_, processId);
      CFRelease(up);
    }
  }

  void Type(NSDictionary *action) {
    const auto processId = ProcessId(action);
    NSString *text = String(action, @"text") ?: @"";
    if (processId) {
      AXRef focused = CopyFocusedElement(*processId);
      AXUIElementRef target = focused ? focused.get() : active_;
      if (target) {
        if (AXUIElementSetAttributeValue(target, kAXSelectedTextAttribute,
                                         (__bridge CFStringRef)text) ==
                kAXErrorSuccess ||
            AXUIElementSetAttributeValue(target, kAXValueAttribute,
                                         (__bridge CFStringRef)text) ==
                kAXErrorSuccess) {
          SetActive(target);
          return;
        }
      }
    }
    if (isVirtual_) {
      throw std::runtime_error(
          "The target application has no editable focused AX element");
    }
    Activate(processId);
    const NSUInteger length = text.length;
    std::vector<UniChar> characters(length);
    if (length > 0) {
      [text getCharacters:characters.data() range:NSMakeRange(0, length)];
    }
    CGEventRef down = CGEventCreateKeyboardEvent(nullptr, 0, true);
    CGEventKeyboardSetUnicodeString(down, length, characters.data());
    PostEvent(down, false, processId);
    CFRelease(down);
    CGEventRef up = CGEventCreateKeyboardEvent(nullptr, 0, false);
    PostEvent(up, false, processId);
    CFRelease(up);
  }
};

napi_value Perform(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1) {
    napi_throw_type_error(env, nullptr,
                          "Native computer input expects one request");
    return nullptr;
  }
  try {
    const std::string json = StringValue(env, argv[0]);
    @autoreleasepool {
      NSData *data = [NSData dataWithBytes:json.data() length:json.size()];
      NSError *parseError = nil;
      id value = [NSJSONSerialization JSONObjectWithData:data
                                                 options:0
                                                   error:&parseError];
      if (parseError || ![value isKindOfClass:[NSDictionary class]]) {
        throw std::runtime_error("Invalid native computer input request");
      }
      NSDictionary *request = value;
      const bool isVirtual =
          [String(request, @"inputMode") isEqualToString:@"virtual"];
      Driver(isVirtual).Run(Array(request, @"actions"));
    }
  } catch (const std::exception &error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  } catch (NSException *exception) {
    napi_throw_error(env, nullptr, exception.reason.UTF8String);
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

} // namespace

NAPI_MODULE_INIT() {
  napi_value perform;
  napi_create_function(env, "perform", NAPI_AUTO_LENGTH, Perform, nullptr,
                       &perform);
  napi_set_named_property(env, exports, "perform", perform);
  return exports;
}
