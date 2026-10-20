// Sets the project up the first time it's opened, so there's nothing to
// configure by hand: the app's name and Android settings, the main scene
// (empty; the game builds itself in code), and the shaders the code asks
// for by name, which a phone build would otherwise leave out.
// Run it again any time from the menu: Graveway → Set up project.

using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Graveway.EditorTools
{
    [InitializeOnLoad]
    static class ProjectSetup
    {
        const string ScenePath = "Assets/Graveway/Scenes/Main.unity";
        static readonly string[] Shaders = { "Standard", "Unlit/Color", "Legacy Shaders/Particles/Additive", "Sprites/Default" };

        static ProjectSetup()
        {
            string key = "Graveway.setup." + Application.dataPath;
            if (EditorPrefs.GetBool(key, false)) return;
            EditorApplication.delayCall += () => { Run(); EditorPrefs.SetBool(key, true); };
        }

        [MenuItem("Graveway/Set up project")]
        static void Run()
        {
            PlayerSettings.productName = "Graveway";
            PlayerSettings.companyName = "The Jump Vault";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.thejumpvault.gravewayunity");
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(ScenePath) == null)
            {
                System.IO.Directory.CreateDirectory("Assets/Graveway/Scenes");
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, ScenePath);
            }
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            if (SceneManager.GetActiveScene().path != ScenePath) EditorSceneManager.OpenScene(ScenePath);

            AlwaysInclude(Shaders);
            AssetDatabase.SaveAssets();
            Debug.Log("Graveway: project set up. Press Play.");
        }

        static void AlwaysInclude(string[] names)
        {
            var assets = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            if (assets == null || assets.Length == 0) return;
            var so = new SerializedObject(assets[0]);
            var list = so.FindProperty("m_AlwaysIncludedShaders");
            foreach (var name in names)
            {
                var shader = Shader.Find(name);
                if (shader == null) continue;
                bool has = false;
                for (int i = 0; i < list.arraySize; i++) if (list.GetArrayElementAtIndex(i).objectReferenceValue == shader) has = true;
                if (has) continue;
                list.InsertArrayElementAtIndex(list.arraySize);
                list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
            }
            so.ApplyModifiedProperties();
        }
    }
}
