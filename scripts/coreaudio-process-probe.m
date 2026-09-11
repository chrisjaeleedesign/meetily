#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <CoreAudio/CoreAudio.h>

static BOOL getUInt32Property(AudioObjectID objectID, AudioObjectPropertySelector selector, UInt32 *value) {
    AudioObjectPropertyAddress address = {
        .mSelector = selector,
        .mScope = kAudioObjectPropertyScopeGlobal,
        .mElement = kAudioObjectPropertyElementMain,
    };
    UInt32 size = sizeof(UInt32);
    OSStatus status = AudioObjectGetPropertyData(objectID, &address, 0, NULL, &size, value);
    return status == noErr;
}

static NSString *getStringProperty(AudioObjectID objectID, AudioObjectPropertySelector selector) {
    AudioObjectPropertyAddress address = {
        .mSelector = selector,
        .mScope = kAudioObjectPropertyScopeGlobal,
        .mElement = kAudioObjectPropertyElementMain,
    };
    CFStringRef value = NULL;
    UInt32 size = sizeof(CFStringRef);
    OSStatus status = AudioObjectGetPropertyData(objectID, &address, 0, NULL, &size, &value);
    if (status != noErr || value == NULL) {
        return @"";
    }
    return CFBridgingRelease(value);
}

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        AudioObjectPropertyAddress address = {
            .mSelector = kAudioHardwarePropertyProcessObjectList,
            .mScope = kAudioObjectPropertyScopeGlobal,
            .mElement = kAudioObjectPropertyElementMain,
        };

        UInt32 size = 0;
        OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size);
        if (status != noErr || size == 0) {
            fprintf(stderr, "failed_to_get_process_list_size status=%d\n", status);
            return 1;
        }

        UInt32 count = size / sizeof(AudioObjectID);
        AudioObjectID *processes = calloc(count, sizeof(AudioObjectID));
        if (processes == NULL) {
            fprintf(stderr, "allocation_failed\n");
            return 1;
        }

        status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, processes);
        if (status != noErr) {
            fprintf(stderr, "failed_to_get_process_list status=%d\n", status);
            free(processes);
            return 1;
        }

        printf("object_id\tpid\trunning_output\tprocess_bundle_id\trunning_app_bundle_id\tname\n");
        for (UInt32 i = 0; i < count; i++) {
            AudioObjectID processObjectID = processes[i];
            UInt32 pidValue = 0;
            UInt32 runningOutput = 0;
            if (!getUInt32Property(processObjectID, kAudioProcessPropertyPID, &pidValue)) {
                continue;
            }
            getUInt32Property(processObjectID, kAudioProcessPropertyIsRunningOutput, &runningOutput);
            NSString *processBundleID = getStringProperty(processObjectID, kAudioProcessPropertyBundleID);
            NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:(pid_t)pidValue];
            NSString *runningAppBundleID = app.bundleIdentifier ?: @"";
            NSString *name = app.localizedName ?: @"";
            printf("%u\t%u\t%u\t%s\t%s\t%s\n",
                   processObjectID,
                   pidValue,
                   runningOutput,
                   processBundleID.UTF8String,
                   runningAppBundleID.UTF8String,
                   name.UTF8String);
        }

        free(processes);
    }
    return 0;
}
