# Keka Integration Checklist

## ✅ What Was Fixed in Code

### 1. **Keka Service Payload Structure** (`backend/src/services/keka/keka.service.ts`)
- **Before**: Sending a flat object `{ EmployeeAttendanceNumber, timestamp, type, metadata }`
- **After**: Sending an array of log objects matching Keka's exact spec:
  ```json
  [
    {
      "DeviceIdentifier": "4f5b878d-7fe4-4b34-8eed-651b3d20c4c2",
      "EmployeeAttendanceNumber": "U123ABC456789",
      "Timestamp": "2025-11-25T14:30:00",
      "Status": 0
    }
  ]
  ```

### 2. **Separate Axios Instance for Attendance Ingestion**
- Created dedicated `attendanceHttp` client with:
  - Base URL: `https://cin03.a.keka.com` (configurable via `KEKA_ATTENDANCE_BASE_URL`)
  - Path: `/v1/logs`
  - Header: `X-API-Key` (exact casing, case-sensitive)
  - Correct Content-Type header

### 3. **Event Type to Status Code Mapping** (`backend/src/queues/kekaSync.queue.ts`)
- Maps our internal event types to Keka status codes:
  - `CLOCK_IN` → 0
  - `CLOCK_OUT` → 1
  - `BREAK_START` → 2
  - `BREAK_END` → 3

### 4. **Timestamp Formatting**
- Converts UTC timestamp to IST without offset: `"YYYY-MM-DDTHH:MM:SS"`
- Removes milliseconds and timezone (Keka expects "naive" ISO format)

### 5. **Environment Variables** (`backend/.env`)
```
KEKA_DEVICE_ID=4f5b878d-7fe4-4b34-8eed-651b3d20c4c2
KEKA_ATTENDANCE_API_KEY=6f2ae45d-0513-441f-b88c-40a955b1c555
KEKA_ATTENDANCE_BASE_URL=https://cin03.a.keka.com
```

---

## ⚠️ What Needs Your Confirmation

### 1. **EmployeeAttendanceNumber Field**
- **Current assumption**: We use `employee.keka_id` from DB
- **Question**: Is `keka_id` the Keka-assigned attendance number?
- **If no**: Do you want to store a separate `keka_attendance_number` field and update the worker to use that?
- **Keka docs reference**: "the unique attendance number of each employee, as registered on the Keka portal"

### 2. **Status Code Mapping**
- **Current mapping**: CLOCK_IN=0, CLOCK_OUT=1, BREAK_START=2, BREAK_END=3
- **Question**: Are these the correct Keka status codes for your device type?
- **Check**: Log in to Keka portal → Device Management → verify status codes for your device

### 3. **Device Identifier**
- **Current value**: `4f5b878d-7fe4-4b34-8eed-651b3d20c4c2` (from .env)
- **Question**: Is this the correct Device GUID for your Slack device?
- **Do NOT use**: The example GUID from Keka docs; this should be your actual device ID

### 4. **API Key**
- **Current value**: `6f2ae45d-0513-441f-b88c-40a955b1c555` (from .env)
- **Question**: Is this the attendance ingestion API key (separate from the HRIS API key)?
- **Check**: Confirm with your Keka CSM that this key has write permissions to `/v1/logs`

### 5. **Base URL Endpoint**
- **Current value**: `https://cin03.a.keka.com` (hardcoded default)
- **Question**: Is this the correct Keka ingestion endpoint for your region?
- **Options**: May vary by region (e.g., `cin03`, `cin04`, `us01`, etc.)

---

## 🧪 Testing the Integration

### 1. **Mock Test** (before real usage)
```bash
# Test that the payload structure is correct
node -r dotenv/config backend/src/services/keka/keka.service.ts

# Or in a small test script, call:
# kekaService.pushAttendance({
#   deviceId: '4f5b878d-7fe4-4b34-8eed-651b3d20c4c2',
#   employeeAttendanceNumber: 'TEST_EMPLOYEE_ID',
#   timestamp: '2025-11-25T14:30:00',
#   status: 0,
# })
```

### 2. **Worker Test** (after confirming employee number)
```bash
# Start the Keka sync worker
node -r dotenv/config backend/src/services/keka/kekaSync.worker.ts

# Insert a test attendance event and watch the worker sync it to Keka
```

### 3. **Verify in Keka Portal**
- Log in to Keka → Attendance → Device Logs
- Look for your test employee's punch in the last hour
- Confirm timestamp, status, and other fields match

---

## ⚠️ Critical API Contract Points

From Keka help.keka.com:

1. **Endpoint**: `POST https://cin03.a.keka.com/v1/logs`
2. **Body**: Array of objects (even for single log)
3. **Fields** (exact casing):
   - `DeviceIdentifier` (GUID, provided by Keka)
   - `EmployeeAttendanceNumber` (unique per employee in Keka)
   - `Timestamp` (ISO 8601 without offset: `YYYY-MM-DDTHH:MM:SS`)
   - `Status` (integer: 0=IN, 1=OUT, or your device's mapping)
4. **Header**: `X-API-Key: <your-api-key>` (case-sensitive)
5. **Content-Type**: `application/json`

---

## Next Steps

1. **Verify all 5 confirmation items above with your Keka CSM or dashboard**
2. **Update .env with correct values if any differ**
3. **Run the integration test**
4. **Monitor Keka logs for successful submissions**
5. **Check Slack Home for refresh updates after punches**

