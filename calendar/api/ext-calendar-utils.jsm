/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = [
  "isOwnCalendar",
  "unwrapCalendar",
  "getResolvedCalendarById",
  "isCachedCalendar",
  "convertCalendar",
  "propsToItem",
  "convertItem",
  "convertAlarm",
];

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetters(this, {
  cal: "resource:///modules/calendar/calUtils.jsm",
  ICAL: "resource:///modules/calendar/Ical.jsm",
  CalEvent: "resource:///modules/CalEvent.jsm",
  CalTodo: "resource:///modules/CalTodo.jsm",
});

var { ExtensionError } = ChromeUtils.import(
  "resource://gre/modules/ExtensionUtils.jsm"
).ExtensionUtils;

function isOwnCalendar(extension, calendar) {
  return calendar.type == "ext-" + extension.id;
}

function unwrapCalendar(calendar) {
  let unwrapped = calendar.wrappedJSObject;

  if (unwrapped.mUncachedCalendar) {
    unwrapped = unwrapped.mUncachedCalendar.wrappedJSObject;
  }

  return unwrapped;
}

function getResolvedCalendarById(extension, id) {
  let calendar;
  let calmgr = cal.getCalendarManager();
  if (id.endsWith("#cache")) {
    let cached = calmgr.getCalendarById(id.substring(0, id.length - 6));
    calendar = cached && isOwnCalendar(extension, cached) && cached.wrappedJSObject.mCachedCalendar;
  } else {
    calendar = calmgr.getCalendarById(id);
  }

  if (!calendar) {
    throw new ExtensionError("Invalid calendar: " + id);
  }
  return calendar;
}

function isCachedCalendar(id) {
  // TODO make this better
  return id.endsWith("#cache");
}

function convertCalendar(extension, calendar) {
  if (!calendar) {
    return null;
  }

  let props = {
    id: calendar.id,
    type: calendar.type,
    name: calendar.name,
    url: calendar.uri.spec,
    readOnly: calendar.readOnly,
    enabled: !calendar.getProperty("disabled"),
    color: calendar.getProperty("color") || "#A8C2E1",
  };

  if (isOwnCalendar(extension, calendar)) {
    // TODO find a better way to define the cache id
    props.cacheId = calendar.id + "#cache";
    props.capabilities = unwrapCalendar(calendar).capabilities; // TODO needs deep clone?
  }

  return props;
}

function propsToItem(props, baseItem) {
  let item;
  if (baseItem) {
    item = baseItem;
  } else if (props.type == "event") {
    item = new CalEvent();
    cal.dtz.setDefaultStartEndHour(item);
  } else if (props.type == "task") {
    item = new CalTodo();
    cal.dtz.setDefaultStartEndHour(item);
  } else {
    throw new ExtensionError("Invalid item type: " + props.type);
  }

  if (props.formats?.use == "ical") {
    item.icalString = props.formats.ical;
  } else if (props.formats?.use == "jcal") {
    item.icalString = ICAL.stringify(props.formats.jcal);
  } else {
    if (props.id) {
      item.id = props.id;
    }
    if (props.title) {
      item.title = props.title;
    }
    if (props.description) {
      item.setProperty("description", props.description);
    }
    if (props.location) {
      item.setProperty("location", props.location);
    }
    if (props.categories) {
      item.setCategories(props.categories);
    }

    if (props.type == "event") {
      // TODO need to do something about timezone
      if (props.startDate) {
        item.startDate = cal.createDateTime(props.startDate);
      }
      if (props.endDate) {
        item.endDate = cal.createDateTime(props.endDate);
      }
    } else if (props.type == "task") {
      // entryDate, dueDate, completedDate, isCompleted, duration
    }
  }
  return item;
}

function convertItem(item, options) {
  let props = {};

  if (item instanceof Ci.calIEvent) {
    props.type = "event";
  } else if (item instanceof Ci.calITodo) {
    props.type = "task";
  }

  props.id = item.id;
  props.calendarId = item.calendar.superCalendar.id;
  props.title = item.title || "";
  props.description = item.getProperty("description") || "";
  props.location = item.getProperty("location") || "";
  props.categories = item.getCategories();

  if (options.format) {
    props.formats = { use: null };
    let formats = options.returnFormat;
    if (!Array.isArray(formats)) {
      formats = [formats];
    }

    for (let format of formats) {
      switch (format) {
        case "ical":
          props.formats.ical = item.icalString;
          break;
        case "jcal":
          // TODO shortcut when using icaljs backend
          props.formats.jcal = ICAL.parse(item.icalString);
          break;
        default:
          throw new ExtensionError("Invalid format specified: " + format);
      }
    }
  }

  if (props.type == "event") {
    props.startDate = item.startDate.icalString;
    props.endDate = item.endDate.icalString;
  } else if (props.type == "task") {
    // TODO extra properties
  }

  // TODO metadata

  return props;
}

function convertAlarm(item, alarm) {
  const ALARM_RELATED_MAP = {
    [Ci.calIAlarm.ALARM_RELATED_ABSOLUTE]: "absolute",
    [Ci.calIAlarm.ALARM_RELATED_START]: "start",
    [Ci.calIAlarm.ALARM_RELATED_END]: "end",
  };

  return {
    itemId: item.id,
    action: alarm.action.toLowerCase(),
    date: alarm.alarmDate?.icalString,
    offset: alarm.offset?.icalString,
    related: ALARM_RELATED_MAP[alarm.related],
  };
}